import {  model, Schema } from "mongoose";
const OrderSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    wallet: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
    },
    indexTokenAddress: {
      type: String,
    },
    sl: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    orderAsset: {
      type: Object,
      required: true,
    },
    chainId: {
      type: Number,
      required: true,
    },
    strategy: {
      type: String,
      required: true,
    },
    entry: {
      type: Object,
      default: {},
    },
    amount: {
      type: Object,
      default: {
        orderSize: "0",
        tokenAmount: "0",
      },
    },
    orderStatus: {
      type: String,
      required: true,
    },
    orderType: {
      type: String,
      default: "BUY",
    },
    message: {
      type: String,
      default: "",
    },
    exit: {
      type: Object,
      default: {
        takeProfit: {
          takeProfitPrice: "0",
          takeProfitPercentage: 1000,
          profit: "0",
        },
        stopLoss: {
          stopLossPrice: "0",
          stopLossPercentage: 0,
          loss: "0",
          isActive: false,
        },
      },
    },
    priority: {
      type: Number,
      default: 1,
    },
    isTrailingMode: {
      type: Boolean,
      default: false,
    },
    reEntrance: {
      type: Object,
      default: {
        isReEntrance: false,
        reEntranceLimit: 0,
      },
    },
    executionFee: {
      type: Object,
      default: {
        nativeFeeInUsd: "0",
        payInUsd: "0",
      },
    },
    isBusy: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    slippage: {
      type: Number,
      default: 500
    },
    additional: {
      type: Object,
      default: {
        executionSpeed: "standard",
        rotation: 0,
        realizedPnl: "0",
      },
    },
  },
  { timestamps: true },
);
export default model("Order", OrderSchema);
