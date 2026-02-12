import { model, Schema } from "mongoose";
const ActivitySchema = new Schema(
  {
    wallet: {
      type: Schema.Types.ObjectId,
      ref: "Wallet",
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
    },
    receiver: String,
    status: String,
    receiveToken: {
      type: Object,
    },
    payToken: {
      type: Object,
    },
    txFee: {
      type: Object,
    },
    indexToken: String,
    type: String,
    chainId: Number,
    feeToken: {
      type: Object,
    },
    info: {
      type: Object,
    },
    txHash: {
      type: String,
    },
  },
  { timestamps: true },
);
export default model("Activity", ActivitySchema);
