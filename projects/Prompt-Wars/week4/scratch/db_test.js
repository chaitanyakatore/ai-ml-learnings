// StadiumPulse AI — Database Integration & Security Diagnostics Test
import dotenv from 'dotenv';
import { db, hashPassword, verifyPassword, isPostgres } from '../services/database.js';

dotenv.config();

async function runDiagnostics() {
  console.log("==================================================");
  console.log("STADUMPULSE AI: STORAGE ENGINE INTEGRATION CHECKS");
  console.log("==================================================");
  console.log(`Detected Mode: ${isPostgres ? "PostgreSQL (Production/Render)" : "SQLite Local JSON File Failover"}`);

  try {
    // 1. Initialize Database Schema
    console.log("\n[TEST 1] Initializing Storage Engine...");
    await db.init();
    console.log("-> Success!");

    // 2. Test Cryptographic PBKDF2 Password Hashing
    console.log("\n[TEST 2] Testing Password Cryptographic Hashing...");
    const rawPassword = "keynote_super_secret_101";
    const encryptedHash = hashPassword(rawPassword);
    
    console.log(`- Original Password: ${rawPassword}`);
    console.log(`- Encrypted Salt/Hash: ${encryptedHash}`);
    
    const isValidMatch = verifyPassword(rawPassword, encryptedHash);
    console.log(`- Verification Check: ${isValidMatch ? "PASS" : "FAIL"}`);

    const isWrongMatch = verifyPassword("incorrect_guess", encryptedHash);
    console.log(`- Brute-Force Rejection Check: ${!isWrongMatch ? "PASS" : "FAIL"}`);

    if (!isValidMatch || isWrongMatch) {
      throw new Error("Cryptographic verification check failed.");
    }

    // 3. Query Default Personas
    console.log("\n[TEST 3] Fetching Default Seed Records...");
    const operatorRecord = await db.findByUsername('operator');
    if (operatorRecord) {
      console.log(`-> Found Operator Account: "${operatorRecord.name}"`);
      console.log(`- Question: ${operatorRecord.securityQuestion}`);
    } else {
      throw new Error("Default Operator account not found in database.");
    }

    // 4. Test Registration Lifecycle
    console.log("\n[TEST 4] Simulating User Registration flow...");
    const testUsername = `diag_test_${Date.now()}`;
    const testUserData = {
      username: testUsername,
      password: "password456",
      role: "volunteer",
      name: "Diagnostics Agent",
      securityQuestion: "What is your mascot?",
      securityAnswer: "zabivaka"
    };

    const registeredUser = await db.createUser(testUserData);
    console.log(`-> Registered User: '${registeredUser.username}' with role '${registeredUser.role}'`);

    // Verify lookup
    const lookupRecord = await db.findByUsername(testUsername);
    if (!lookupRecord) {
      throw new Error("Registered diagnostics user not found in database lookup.");
    }
    console.log(`-> Successfully verified database write for '${testUsername}'`);

    // 5. Test Password Recovery Flow
    console.log("\n[TEST 5] Simulating Security-Question Password Reset flow...");
    const isAnswerCorrect = verifyPassword("zabivaka", lookupRecord.securityAnswerHash);
    console.log(`- Recover Answer Check: ${isAnswerCorrect ? "PASS" : "FAIL"}`);

    if (!isAnswerCorrect) {
      throw new Error("Security answer verification failed.");
    }

    await db.updatePassword(testUsername, "new_secure_pass_999");
    const updatedRecord = await db.findByUsername(testUsername);
    const verifyNewPassword = verifyPassword("new_secure_pass_999", updatedRecord.passwordHash);
    console.log(`- Password Update Integrity Check: ${verifyNewPassword ? "PASS" : "FAIL"}`);

    if (!verifyNewPassword) {
      throw new Error("Integrity check on reset password failed.");
    }

    console.log("\n==================================================");
    console.log("STATUS: ALL DIAGNOSTIC TESTS PASSED SUCCESSFULLY! ✅");
    console.log("==================================================");
    process.exit(0);

  } catch (err) {
    console.error("\n[DIAGNOSTICS ERROR]: Tests failed to execute:", err.message);
    console.log("==================================================");
    console.log("STATUS: TESTING FAILED! ❌");
    console.log("==================================================");
    process.exit(1);
  }
}

runDiagnostics();
