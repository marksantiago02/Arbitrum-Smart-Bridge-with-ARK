import express, { Request, Response } from 'express';
import { ethers } from 'ethers';
import { getUserInfoByEthAddress } from '../db';
import { createHmeshBridgeClient, getCurrentVotes } from '../hmesh-client';

const router = express.Router();
const hmeshClient = createHmeshBridgeClient();

// Endpoint to cast votes on behalf of the user
router.post('/vote', async function(req: Request, res: Response) {
  try {
    const { arbitrumAddress, signature, message, delegatePublicKey } = req.body;
    
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

    const transaction = await hmeshClient.submitVote(userInfo.hmeshInfo.hmeshAddress, delegatePublicKey);
    
    res.json({
      success: true,
      transactionId: transaction,
      message: 'Vote submitted successfully'
    });
  } catch (error) {
    console.error('Error submitting vote:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Endpoint to unvote a delegate
router.post('/unvote', async function(req: Request, res: Response) {
  try {
    const { arbitrumAddress, signature, message, delegatePublicKey } = req.body;
    
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
    
    const transaction = await hmeshClient.submitUnvote(userInfo.hmeshInfo.hmeshAddress, delegatePublicKey);
    
    res.json({
      success: true,
      transactionId: transaction,
      message: 'Unvote submitted successfully'
    });
  } catch (error) {
    console.error('Error submitting unvote:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Endpoint to get wallet balance and voting status
router.post('/status', async function(req: Request, res: Response) {
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

    const balance = await hmeshClient.getBalance(userInfo.hmeshInfo.hmeshAddress);

    const currentVotes = await getCurrentVotes(userInfo.hmeshInfo.hmeshAddress);
    
    res.json({
      hmeshAddress: userInfo.hmeshInfo.hmeshAddress,
      balance,
      currentVotes,
      message: 'Wallet status retrieved successfully'
    });
  } catch (error) {
    console.error('Error retrieving wallet status:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
