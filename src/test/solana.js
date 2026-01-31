import {
  transferSolNative,
  transferSOLTokens,
} from "../Api/blockchain/svm/svmTransfer.js";
import { executeSolanaSwap } from "../Api/blockchain/svm/svmTrade.js";
import { solanaKeyPair } from "../Api/lib/walletHandler/create.js";
import { chains } from "../Api/constant/common/chain.js";
import { ZeroAddress } from "ethers";
const tokenOut = "Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump";
const send = async () => {
  try {
    let key =
      "3fefm7H3kRmHYxje4VYN4KmvZ9F67ep8jBD7Uz8b6hD1yUAYhF8QNjC57844UeZnvQwFNwjVtn1bFx93igy4Uure";
    let KeyPair = solanaKeyPair(key);
    let signature = await transferSolNative({
      chainId: chains.Solana,
      receiver: "BLvk55ch6uWM2j9YUX9pUfmfbuA8CWdXuDMZ3og3J4RN",
      value: "10000",
      KeyPair,
    });
    console.log(signature);
  } catch (err) {
    console.log(err);
  }
};

const swap = async () => {
  try {
    let key =
      "3fefm7H3kRmHYxje4VYN4KmvZ9F67ep8jBD7Uz8b6hD1yUAYhF8QNjC57844UeZnvQwFNwjVtn1bFx93igy4Uure";
    let KeyPair = solanaKeyPair(key);
    let result = await executeSolanaSwap({
      tokenIn: ZeroAddress,
      tokenOut,
      amountIn: "100000",
      slippage: 1000,
      keyPair: KeyPair,
    });
    console.log(result);
  } catch (err) {
    console.log(err);
  }
};

swap();
