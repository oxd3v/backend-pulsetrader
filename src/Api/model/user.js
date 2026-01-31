import {  Schema, model } from "mongoose";

const UserSchema = new Schema(
  {
    account: {
      type: String,
      required: true,
    },
    inviter: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    invites: [{
        type: Schema.Types.ObjectId,
        ref: "User",
    }],
    status: {
      type: String,
      default: "silver",
    },
    statusTimeline: {
      type: Date,
      default: 0,
    },
    isBlock: {
      type: Boolean,
      default: false,
    },
    blockReason: {
      type: String,
      default: "",
    },
    invitationCodes: [
      {
        type: String,
      },
    ],
    assetes: [
      {
        type: String,
      },
    ],
  },
  { timestamps: true },
);
export default model("User", UserSchema);
