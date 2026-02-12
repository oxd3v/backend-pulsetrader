import logger from "../logger.js";
import OrderModel from "../model/order.js";
import { USER_LEVEL, userDeafultTokens } from "../constant/common/user.js";
import {
  openSpotOrderOnRequest,
  closeOpenOrderOnRequest,
} from "../lib/orderHandler/executeOnRequest.js";
import { MINIMUM_COLLATERAL_USD } from "../constant/common/order.js";
import { chainConfig } from "../constant/common/chain.js";
import { COLLATERAL_TOKEN_DATA_MAP } from "../../Listener/listen/token.js";
import { validateParams } from "./user.js";
import { ZeroAddress } from "ethers";
import { convertToTokenAmount } from "../lib/utility/number.js";

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
    return res.status(400).send({ message: "MISSING_PARAMS" });
  }

  const validationError = validateParams(req.body, [
    "indexToken",
    "strategy",
    "chainId",
    "category",
    "name",
  ]);
  if (validationError) {
    return res.status(400).json(validationError);
  }

  try {
    let orderNameAlreadyUsed = await OrderModel.find({
      user: user._id,
      name: { $regex: new RegExp(`^${name}$`, "i") },
    }).catch((err) => {
      return res.status(500).send({ message: "SERVER_ERROR", type: 2 });
    });

    if (orderNameAlreadyUsed.length > 0) {
      return res.status(500).send({ message: "ORDER_NAME_ALREADY_EXIST" });
    }

    if (gridsByWallet && orders.length !== Object.values(gridsByWallet).length) {
      return res.status(400).send({ message: "ORDERS_WALLET_NOT_MATCHED" });
    }

    const userState = USER_LEVEL[user.status.toUpperCase()];
    const selectedWallets = [...new Set(Object.values(gridsByWallet))];

    if (!selectedWallets.length) {
      return res.status(400).send({ message: "NO_VALID_WALLET" });
    }

    if (
      user.status != "admin" &&
      !userState?.benefits.supportStrategy.includes(strategy)
    ) {
      return res.status(400).send({
        message: "UNSUPPORTED_STRATEGY",
      });
    }

    if (user.status != "admin") {
      let collateralToken = orders[0].orderAsset.collateralToken;
      let priceToken =
        collateralToken.address == ZeroAddress
          ? chainConfig[chainId].nativeToken
          : collateralToken;
      let tokenKey = `${chainId}:${priceToken.address.toLowerCase()}`;
      let priceUsdString = COLLATERAL_TOKEN_DATA_MAP.get(tokenKey) || 0;
      let tokenAmount = convertToTokenAmount(
        MINIMUM_COLLATERAL_USD,
        priceToken.decimals,
        BigInt(priceUsdString),
      );
      if (tokenAmount > 0n) {
        for(let order of orders){
          if (BigInt(order.amount.orderSize) < tokenAmount) {
            return res
              .status(400)
              .send({ message: "MINIMUM_USD_COLLATERAL_NEED" });
          }
        }
      }
    }

    const prevOrders = await OrderModel.find({ user: user._id });
    let extraAdditional = {};
    // Validate trading conditions
    if (category === "perpetual") {
      if (isLong === undefined) {
        return res.status(400).send({ message: "INVALID_ORDER" });
      }

      if (
        user.status != "admin" &&
        !userState.benefits.supportTrading.includes("perpetual")
      ) {
        return res.status(400).send({ message: "UNSUPPORTED_TRADING" });
      }

      if (
        ["limit", "grid"].includes(strategy) &&
        selectedWallets.length !== 1
      ) {
        return res.status(400).send({
          message: "INVALID_WALLET_ONE",
        });
      }

      if (
        strategy === "multiScalp" &&
        selectedWallets.length !== orders.length
      ) {
        return res.status(400).send({
          message: "NO_UNIQUE_WALLET",
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
          message: "UNSUPPORTED_PERPETUAL_WALLET",
        });
      }
    }

    if (category === "spot") {
      if (
        ["limit", "scalp"].includes(strategy) &&
        selectedWallets.length !== 1
      ) {
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
          message: "ASSET_NOT_ADDED",
        });
      }
    }

    const totalOrdersAfterAdd = prevOrders.length + orders.length;
    if (
      user.status != "admin" &&
      totalOrdersAfterAdd > userState.benefits.maxOrder
    ) {
      return res.status(500).send({
        message: `EXCEED_ORDER_LIMIT`,
      });
    }

    try {
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
    } catch (err) {
      return res.status(500).send({
        message: `ORDER_CREATED_FAILED`,
      });
    }

    let userAllOrders = [];
    userAllOrders = await OrderModel.find({ user: user._id })
      .populate("wallet", "_id address")
      .populate("user", "_id account")
      .catch((err) => {});

    return res.status(200).json({
      success: true,
      message: "Orders added successfully",
      orderCount: orders.length,
      allOrders: userAllOrders,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "SERVER_ERROR",
    });
  }
};

export const deleteOrder = async (req, res) => {
  const user = req.user;
  const { orderId } = req.body;

  try {
    // Find and verify order belongs to user
    const orderToDelete = await OrderModel.findOne({
      _id: orderId,
      user: user._id,
    });

    if (!orderToDelete) {
      return res.status(500).json({
        success: false,
        message: "ORDER_NOT_EXIST",
      });
    }

    // Check if order can be deleted
    if (orderToDelete.isBusy) {
      return res.status(400).json({
        success: false,
        message: "ORDER_IS_USE",
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
      message: `SERVER_ERROR`,
    });
  }
};

export const getOrder = async (req, res) => {
  let user = req.user;
  let {} = req,
    query;
  try {
    let orders = await OrderModel.find({ user: user._id })
      .populate("user", "account status inviter")
      .populate("wallet", "address ");
    return res.status(200).send({ orders });
  } catch (err) {
    return res.status(500).send({ message: "SERVER_ERROR" });
  }
};

export const openOrder = async (req, res) => {
  const { user } = req;
  const { orderId } = req.body;

  try {
    const orderData = await OrderModel.findOne({ _id: orderId, user: user._id })
      .populate("wallet", "_id address")
      .populate("user", "_id account status");

    if (!orderData) {
      return res.status(500).json({
        success: false,
        message: "ORDER_NOT_EXIST",
      });
    }

    if (orderData.orderStatus !== "PENDING" || orderData.orderType !== "BUY") {
      return res.status(400).json({
        success: false,
        message: "INVALID_ORDER",
      });
    }

    // Check if order can be deleted
    if (orderData.isBusy) {
      return res.status(400).json({
        success: false,
        message: "ORDER_IN_USE",
      });
    }

    try {
      await openSpotOrderOnRequest(orderData);
      return res.status(200).json({
        success: true,
        message: "ORDER_OPENED",
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: `ORDER_OPEN_FAILED`,
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: `SERVER_ERROR`,
    });
  }
};

export const closeOrder = async (req, res) => {
  const { user } = req;
  const { orderId } = req.body;

  try {
    const orderData = await OrderModel.findOne({
      _id: orderId,
      user: user._id,
    });

    if (!orderData) {
      return res.status(500).json({
        success: false,
        message: "ORDER_NOT_EXIST",
      });
    }

    if (orderData.orderType == "SELL") {
      if (orderData.orderStatus == "PENDING") {
        if (orderData.strategy != "sellToken") {
          return res.status(400).json({
            success: false,
            message: "INVALID_ORDER",
          });
        }
      } else if (orderData.orderStatus != "OPENED") {
        return res.status(400).json({
          success: false,
          message: "INVALID_ORDER",
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        message: "INVALID_ORDER",
      });
    }

    // Check if order can be deleted
    if (orderData.isBusy) {
      return res.status(400).json({
        success: false,
        message: "ORDER_IN_USE",
      });
    }

    try {
      await closeOpenOrderOnRequest(orderData);
      return res.status(200).json({
        success: true,
        message: "ORDER_CLOSED",
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: `ORDER_CLOSE_FAILED`,
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: `SERVER_ERROR`,
    });
  }
};
