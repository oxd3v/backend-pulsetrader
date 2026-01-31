import { Schema, model,  } from "mongoose";
const WalletSchema = new Schema({
    address: {
        type: String,
        required: true,
    },
    user: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    encryptedWalletKey: {
        type: String,
        required: true,
    },
    network: {
        type: String
    },
    index: Number,
    name: String,
});
export default model("Wallet", WalletSchema);