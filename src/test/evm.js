import { Wallet, ethers, NonceManager, parseEther } from "ethers";
import { decrypt } from "../Api/lib/crypto/encryption.js";
import { getConnectionProvider } from "../Api/constant/common/chain.js";



// export const test = async ()=>{
//     let provider = new ethers.JsonRpcProvider('https://api.avax.network/ext/bc/C/rpc');
//     let signer = new Wallet(pk);
//     let nonceSigner = new NonceManager(signer);
//     console.log(nonceSigner)
//     let networkSigner = nonceSigner.connect(provider);
//     console.log(networkSigner)
//     let tx = await networkSigner.estimateGas({to:'0xfe7AB0137C85c9f05d03d69a35865277EA64DEba', value: parseEther('0.001')});
//     console.log(tx)
// }
