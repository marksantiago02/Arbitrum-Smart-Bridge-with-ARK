// import axios from 'axios';
// import dotenv from 'dotenv'
// const { Connection } = require("@arkecosystem/client");
// const {Transactions, Managers, Utils} = require("@arkecosystem/crypto");

// dotenv.config();
// const API_URL = process.env.HMESH_DEVNET_NODE_URL;


// const client = new Connection(`${API_URL}/api`);

// Managers.configManager.setFromPreset("devnet");
// Managers.configManager.setHeight(4006000);

// const response = client.api("transactions").all();
// console.log(response);

// // Configuration

// /**
//  * Test GET request - Fetch latest transactions
//  */
// async function testGetTransactions() {
//   try {
//     console.log('Testing GET transactions...');
    
//     const response = await axios.get(`${API_URL}/api/transactions`, {
//       params: {
//         limit: 5,
//         page: 1,
//         orderBy: 'timestamp:desc'
//       }
//     });
    
//     console.log('GET Success! Latest 5 transactions:');
//     response.data.data.forEach((tx: any) => {
//       console.log(`ID: ${tx.id}, Amount: ${tx.amount}, Sender: ${tx.sender}`);
//     });
    
//     return response.data;
//   } catch (error:any) {
//     console.error('GET Error:', error.message);
//     if (error.response) {
//       console.error('Response data:', error.response.data);
//     }
//   }
// }

// /**
//  * Test POST request - Broadcast a transaction
//  * Note: This is a sample transaction and will fail validation
//  * Replace with a properly signed transaction for actual testing
//  */
// async function testPostTransaction() {
//   try {
//     console.log('\nTesting POST transaction...');
    
//     // This is a sample transaction structure

//     const sampleTransaction = {
//       version: 2,
//       network: 23, // devnet
//       type: 0,
//       nonce: "1",
//       senderPublicKey: "03287bfebba4c7881a0509717e71b34b63f31e40021c321f89ae04f84be6d6ac37",
//       fee: "10000000",
//       amount: "100000000",
//       recipientId: "D8rr7B1d6TL6pf14LgMz4sKp1VBMs6YUYD",
//       signature: "sample_signature_replace_with_real_one",
//       id: "sample_id_replace_with_real_one"
//     };
    
//     const response = await axios.post(`${API_URL}/transactions`, {
//       transactions: [sampleTransaction]
//     });
    
//     console.log('POST Success! Response:', response.data);
//     return response.data;
//   } catch (error:any) {
//     console.error('POST Error:', error.message);
//     if (error.response) {
//       console.error('Response data:', error.response.data);
//     }
//   }
// }

// /**
//  * Test GET request - Fetch transaction fees
//  */
// async function testGetTransactionFees() {
//   try {
//     console.log('\nTesting GET transaction fees...');
    
//     const response = await axios.get(`${API_URL}/transactions/fees`);
    
//     console.log('GET Success! Transaction fees:');
//     console.log(JSON.stringify(response.data.data, null, 2));
    
//     return response.data;
//   } catch (error:any) {
//     console.error('GET Error:', error.message);
//     if (error.response) {
//       console.error('Response data:', error.response.data);
//     }
//   }
// }

// /**
//  * Run all tests
//  */
// async function runTests() {
//   try {
//     // Test GET endpoints
//     await testGetTransactions();
//     await testGetTransactionFees();
    
//     // Test POST endpoint (will likely fail without a proper signature)
//     await testPostTransaction();
    
//     console.log('\nAll tests completed!');
//   } catch (error) {
//     console.error('Test execution error:', error);
//   }
// }

// // Run the tests
// // runTests();


import axios from 'axios';
import dotenv from 'dotenv';
const { Connection } = require("@arkecosystem/client");
const { Transactions, Managers, Utils } = require("@arkecosystem/crypto");

dotenv.config();

const API_URL = process.env.HMESH_DEVNET_NODE_URL;
console.log("Using API URL:", API_URL); // Log the URL to verify it's correct

// Create a client with a custom timeout
const client = new Connection(`${API_URL}/api`, {
  timeout: 30000, // 10 seconds timeout
});

// Configure the network
Managers.configManager.setFromPreset("devnet");
Managers.configManager.setHeight(4006000);

// First test basic connectivity with axios
async function testConnectivity() {
  try {
    console.log("Testing basic connectivity to the API...");
    const response = await axios.get(`${API_URL}/api/node/status`, {
      timeout: 5000 // 5 seconds timeout
    });
    console.log("API is reachable. Node status:", response.data);
    return true;
  } catch (error:any) {
    console.error("Error connecting to API:", error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error("Connection refused. The server might be down or the URL might be incorrect.");
    } else if (error.code === 'ETIMEDOUT') {
      console.error("Connection timed out. The server might be slow or unreachable.");
    }
    return false;
  }
}

// Then try to get transactions
async function getTransactions() {
  try {
    console.log("Fetching transactions with axios...");
    const response = await axios.get(`${API_URL}/api/transactions`, {
      params: {
        page: 1,
        limit: 10
      },
      timeout: 15000
    });
    console.log("Transactions:", response.data);
    return response.data; 
  } catch (error:any) {
    console.error("Error fetching transactions:", error.message);
    throw error;
  }
}

// Run the tests
async function runTests() {
  const isConnected = await testConnectivity();
  if (isConnected) {
    try {
      await getTransactions();
    } catch (error) {
      console.error("Failed to get transactions.");
    }
  } else {
    console.error("Skipping transaction fetch due to connectivity issues.");
  }
}

runTests();