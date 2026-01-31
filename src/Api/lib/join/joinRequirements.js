import UserModel from "../../model/user.js";
import {
  decrypt,
  encrypt,
  encodeText,
  decodeText,
  decryptAuthToken,
} from "../crypto/encryption.js";
import { getConnectionProvider, chains } from "../../constant/common/chain.js";
import {
  USER_LEVEL,
  DEFAULT_INVITER_ID,
  DEFAULT_INVITATION_EXPIRY,
} from "../../constant/common/user.js";
import STAKE_ABI from "../../constant/abis/stake.js";
import { Contract, ethers, formatUnits } from "ethers";
import "dotenv/config";

const INVITATION_CODE_SECURITY = process.env.INVITATION_CODE_SECURE_KEY;
const STAKE_CONTRACT_ADDRESS = "0x9d2B270361f2bD35aC39E8dA230a1fd54de6BE8E";

// Main verification function
export const checkRequirements = async ({ method, user, option }) => {
  try {
    let update;
    if (method === "INVITATION_CODE") {
      update = await handleInvitationCode({
        invitationCode: option.invitationCode,
        user,
      });
    } else if (method == "GLADIATOR_STAKE_43114") {
      update = await handleGladiatorStake({
        user,
      });
    }
    return {
      success: true,
      update,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
};

export const handleInvitationCode = async ({ invitationCode, user }) => {
  const invitationDetails = decodeInvitationCode(invitationCode);
  // Validate expiration
  if (invitationDetails.expireAt && invitationDetails.expireAt < Date.now()) {
    throw new Error("Expired invitation code");
  }
  // Validate recipient
  if (invitationDetails.to.toLowerCase() !== user.account.toLowerCase()) {
    throw new Error("Unauthorized account to join");
  }
  const inviterUser = await UserModel.findOne({
    invitationCodes: invitationCode,
  }).catch((err) => {
    logger.error(
      `[MONGO_DB_FAILED]: Finding inviter failed. in join request invited => ${invitationDetails.to} and code => ${invitationCode}`,
    );
    throw new Error("Inviter finding failed");
  });

  if (!inviterUser) {
    throw new Error("Invalid or already used invitation code");
  }

  // Atomic findOneAndUpdate to prevent race conditions
  await UserModel.updateOne(
    {
      _id: inviterUser._id,
      // Optionally add: _id: { $ne: user._id } to prevent self-invitation
    },
    {
      $pull: { invitationCodes: invitationCode },
      $push: { invites: user._id },
    },
    {
      new: false, // Return the document before update
      // session: session // Use transaction if needed
    },
  ).catch((err) => {
    logger.error(
      `[MONGO_DB_FAILED]: Update inviter data failed. in join request inviterId => ${inviterUser._id} and code => ${invitationCode}`,
    );
    throw new Error("Update inviter data failed");
  });

  return {
    inviter: inviterUser._id,
    status: invitationDetails.metadata?.status,
  };
};

export const encodeInvitationCode = ({
  invitedTo,
  expireAt = null,
  metadata = {
    status: "silver",
  },
}) => {
  if (!invitedTo) {
    throw new Error("Invitation sender is required");
  }

  if (typeof expireAt !== "number") {
    expireAt = new Date(expireAt).getTime();
  }

  if (!expireAt) {
    expireAt = Date.now() + DEFAULT_INVITATION_EXPIRY;
  }

  const invitationCardObject = {
    to: invitedTo,
    expireAt,
    metadata,
  };

  try {
    const invitationCode = encrypt(
      JSON.stringify(invitationCardObject),
      INVITATION_CODE_SECURITY,
    );

    let encodeInvitationCode = {
      code: invitationCode,
      to: invitedTo,
      expireAt,
      status: metadata.status,
    };

    const code = encodeText(JSON.stringify(encodeInvitationCode));

    return {
      success: true,
      invitationCode: code,
      expiresAt: expireAt,
      invitedTo,
    };
  } catch (error) {
    logger.error(
      `[ENCODE_INVITATION_FAILED]: err: ${JSON.stringify(error.message)}`,
    );
    throw new Error("Failed to encode invitation code");
  }
};

export const decodeInvitationCode = (invitationCode) => {
  if (!invitationCode) {
    throw new Error("Required invitation code");
  }

  try {
    const decodeInvitationCode = decodeText(invitationCode);
    const code = JSON.parse(decodeInvitationCode).code;
    const decryptedData = decrypt(code, INVITATION_CODE_SECURITY);
    const invitationDetails = JSON.parse(decryptedData);

    // Validate decoded data structure
    if (!invitationDetails.to || !invitationDetails.metadata?.status) {
      throw new Error("Invalid invitation code format");
    }

    return invitationDetails;
  } catch (error) {
    logger.error(
      `[INVITATION_DECRYPTION_FAILED]: ${JSON.stringify(error.message)}`,
    );
    throw new Error("Failed to decode invitation code");
  }
};

const handleGladiatorStake = async ({ user }) => {
  try {
    const stakeAmount = await getGladiatorStake(user.account);
    const userLevels = Object.values(USER_LEVEL).reverse();
    let status = userLevels.find((u) => {
      Number(u.requireMents["GLADIATOR_STAKE_43114"].quantity) >
        Number(stakeAmount);
    });
    return {
      status,
      inviter: DEFAULT_INVITER_ID,
    };
  } catch (err) {
    logger.error(
      `[GLADIATOR_STAKE_RETRIEVE_FAILED]: err: ${JSON.stringify(err.message)}`,
    );
    throw new Error("Failed to track gladiator stake");
  }
};

const getGladiatorStake = async (account) => {
  let provider = getConnectionProvider(chains.Avalanche);
  let stakeContract = new Contract(STAKE_CONTRACT_ADDRESS, STAKE_ABI, provider);
  let stakeAmount = await stakeContract.stacked(account);
  return formatUnits(stakeAmount, 18);
};
