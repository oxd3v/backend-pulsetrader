import { Wallet, ethers, NonceManager, parseEther } from "ethers";
import { decrypt } from "../Api/lib/crypto/encryption.js";
import { getConnectionProvider } from "../Api/constant/common/chain.js";



export const test = async ()=>{
    let provider = getConnectionProvider(1);
    let gasFeeObj = await provider.getFeeData();
    let gasPrice = gasFeeObj.gasPrice;
    let fee = BigInt(1000000)*gasPrice;
    console.log(fee);
    let bufferFee = (fee*BigInt(20000))/BigInt(10000);
    console.log(bufferFee);
    // let signer = new Wallet(pk);
    // let nonceSigner = new NonceManager(signer);
    // console.log(nonceSigner)
    // let networkSigner = nonceSigner.connect(provider);
    // console.log(networkSigner)
    // let tx = await networkSigner.estimateGas({to:'0xfe7AB0137C85c9f05d03d69a35865277EA64DEba', value: parseEther('0.001')});
    // console.log(tx)
}

test()
