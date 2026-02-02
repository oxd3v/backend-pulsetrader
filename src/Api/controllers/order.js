import logger from "../logger.js";
import OrderModel from "../model/order.js";
import { USER_LEVEL, userDeafultTokens } from "../constant/common/user.js";

export const addOrder = async (req, res) => {
  const user = req.user;
  const {
    orders,
    gridsByWallet,
    indexToken,
    strategy,
    chainId,
    category,
    isLong,
    name,
  } = req.body;

  if (!orders?.length) {
    return res
      .status(400)
      .send({ message: "Missing required params: orders" });
  }

  if (!indexToken || !strategy || !chainId || !category || !name) {
    const missingParams = [
      !indexToken && "indexToken",
      !strategy && "strategy",
      !chainId && "chainId",
      !category && "category",
      !name && "name",
    ]
      .filter(Boolean)
      .join(", ");
    return res
      .status(400)
      .send({ message: `Missing required parameters: ${missingParams}` });
  }

  let orderNameAlreadyUsed = await OrderModel.find({
    user: user._id,
    name: { $regex: new RegExp(`^${name}$`, "i") },
  }).catch((err) => {
    logger.error(`[MONGODB_FAILED]: ${JSON.stringify(err.message)}`);
    return res.status(500).send({ message: "SERVER_ERROR" });
  });

  if (orderNameAlreadyUsed.length > 0) {
    return res.status(500).send({ message: "EXIST_ORDER_NAME" });
  }

  if (orders.length !== Object.values(gridsByWallet).length) {
    return res
      .status(400)
      .send({ message: "ORDERS_WALLET_NOT_MATCHED" });
  }

  const userState = USER_LEVEL[user.status.toUpperCase()];
  const selectedWallets = [...new Set(Object.values(gridsByWallet))];

  if (!selectedWallets.length) {
    return res.status(400).send({ message: "No valid wallets selected" });
  }

  const prevOrders = await OrderModel.find({ user: user._id });
  let extraAdditional = {};
  // Validate trading conditions
  if (category === "perpetual") {
    if (isLong === undefined) {
      return res
        .status(400)
        .send({ message: "Perpetual order type not defined" });
    }

    if (user.status != 'admin' && !userState.supportTrading.includes("perpetual")) {
      return res
        .status(400)
        .send({ message: "User not authorized for perpetual trading" });
    }

    if (["limit", "grid"].includes(strategy) && selectedWallets.length !== 1) {
      return res
        .status(400)
        .send({
          message: "Perpetual limit/grid strategies require exactly one wallet",
        });
    }

    if (strategy === "multiScalp" && selectedWallets.length !== orders.length) {
      return res.status(400).send({
        message: "Multi-scalp strategy requires one unique wallet per order",
      });
    }

    const existingPerpOrders = prevOrders.filter(
      (o) =>
        o.category === "perpetual" &&
        o.indexTokenAddress.toLowerCase() === indexToken.toLowerCase() &&
        o.isLong === isLong &&
        selectedWallets.includes(o.wallet),
    );

    if (existingPerpOrders.length > 0) {
      return res.status(409).send({
        message: "Selected wallets already have active perpetual orders",
      });
    }
  }

  if (category === "spot") {
    if (["limit", "scalp"].includes(strategy) && selectedWallets.length !== 1) {
      return res.status(500).send({
        message: "ONLY_SINGLE_WALLET",
      });
    }
    let userTokens =
      user.assetes && user.assetes.length > 0
        ? user.assetes
            .filter((token) => token.split(":")[1] == chainId)
            .map((token) => token.split(":")[0].toLowerCase())
        : [];
    let defaultTokens =
      userDeafultTokens.length > 0
        ? userDeafultTokens
            .filter((token) => token.split(":")[1] == chainId)
            .map((token) => token.split(":")[0].toLowerCase())
        : [];
    let addedTokens = [...userTokens, ...defaultTokens];
    if (!addedTokens.includes(indexToken.toLowerCase())) {
      return res.status(500).send({
        message:
          "ASSET_NOT_ADDED",
      });
    }
  }

  const totalOrdersAfterAdd = prevOrders.length + orders.length;
  if (
    user.status != 'admin' &&
    totalOrdersAfterAdd > userState.benefits.maxOrder
  ) {
    return res.status(500).send({
      message: `EXCEED_ORDER_LIMIT`,
    });
  }

  // Create orders
  await OrderModel.insertMany(
    orders.map((order) => ({
      ...order,
      user: user._id,
      wallet: gridsByWallet[order?.sl],
      additional: {
        ...order.additional,
        ...extraAdditional,
      },
    })),
  );

  const userAllOrders = await OrderModel.find({ user: user._id })
    .populate("wallet", "_id address")
    .populate("user", "_id account");

  return res.status(200).json({
    success: true,
    message: "Orders added successfully",
    orderCount: orders.length,
    allOrders: userAllOrders,
  });
};

export const closeOrder = async (req, res) => {
  const { user } = req;
  const { orderId } = req.body;

  try {
    const orderData = await OrderModel.findOne({ _id: orderId, user: user._id })
      .populate("wallet", "_id address")
      .populate("user", "_id account status");

    if (!orderData) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    if (orderData.orderStatus !== "OPENED" || orderData.orderType !== "SELL") {
      return res.status(400).json({
        success: false,
        message: "Invalid order type or status to close",
      });
    }

    // Check if order can be deleted
    if (orderData.isBusy) {
      return res.status(400).json({
        success: false,
        message: "Cannot close order while it is being processed",
      });
    }
    await OrderModel.updateOne({ _id: orderId }, { isBusy: true }).catch(
      (err) => {
        logger.error(`mongoDB failed: ${err.message}`);
        return res.status(500).json({
          success: false,
          message: `mongoDB failed`,
        });
      },
    );

    try {
      orderData.category == "perpetual"
        ? await closePosition(orderData)
        : await closeSpotOrder(orderData);
      return res.status(200).json({
        success: true,
        message: "Order closed successfully",
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: `Failed to execute close order: ${err.message}`,
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: `Error processing close order request: ${err.message}`,
    });
  }
};

export const deleteOrder = async (req, res) => {
  const { user } = req;
  const { orderId } = req.body;

  try {
    // Find and verify order belongs to user
    const orderToDelete = await OrderModel.findOne({
      _id: orderId,
      user: user._id,
    });

    if (!orderToDelete) {
      return res.status(404).json({
        success: false,
        message: "Order not found or unauthorized",
      });
    }

    // Check if order can be deleted
    if (orderToDelete.isBusy) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete order while it is being processed",
      });
    }

    // Delete the order
    await OrderModel.deleteOne({ _id: orderId });

    return res.status(200).json({
      success: true,
      message: "Order deleted successfully",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: `Failed to delete order: ${err.message}`,
    });
  }
};

export const getOrder = async (req, res) => {
  let user = req.user;
  let { } = req,query;
  try{
    let orders = (await OrderModel.find({ user: user._id }).populate('user', 'account status inviter').populate('wallet', 'address '));
    return res.status(200).send({orders})
  }catch(err){
    return res.status(500).send({message: 'SERVER_ERROR'})
  }
}


