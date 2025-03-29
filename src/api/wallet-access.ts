import express, {Request, Response} from 'express';
import { ethers } from 'ethers';
import { getUserInfoByEthAddress } from '../db';

const router = express.Router();

router.post('/get-hmesh-wallet', async function(req: Request, res: Response) {
  try {
    const { arbitrumAddress, signature, message } = req.body;

    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== arbitrumAddress.toLowerCase()) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const userInfo = await getUserInfoByEthAddress(arbitrumAddress);

    if (!userInfo || !userInfo.hmeshInfo) {
      res.status(404).json({ error: 'HMESH wallet not found' });
      return;
    }

    res.json({
      success: true,
      hmeshAddress: userInfo.hmeshInfo.hmeshAddress,
      message: 'HMESH wallet retrieved successfully'
    });
  } catch(error) {
    console.error('Error retrieving HMESH wallet:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;