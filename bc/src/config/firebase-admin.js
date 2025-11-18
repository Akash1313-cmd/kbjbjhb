/**
 * Firebase Admin SDK Configuration
 * For server-side authentication verification
 */

const admin = require('firebase-admin');
const logger = require('../utils/logger');

// Firebase project configuration
const firebaseConfig = {
  projectId: 'gmap-pro-e92d7',
  // You'll need to add the service account key here
};

// Initialize Firebase Admin only if not already initialized
let isInitialized = false;

const initializeFirebaseAdmin = () => {
  if (!isInitialized) {
    try {
      // Check if we have a service account key file
      const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      
      if (serviceAccountPath) {
        // Initialize with service account file
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: firebaseConfig.projectId
        });
      } else if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        // Initialize with service account JSON string from environment variable
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: firebaseConfig.projectId
        });
      } else {
        // Initialize with project ID only (limited functionality)
        // This allows ID token verification without full admin access
        admin.initializeApp({
          projectId: firebaseConfig.projectId
        });
      }
      
      isInitialized = true;
      logger.info('✅ Firebase Admin SDK initialized successfully');
    } catch (error) {
      logger.error('❌ Firebase Admin SDK initialization failed:', { error: error.message });
      throw error;
    }
  }
};

// Verify Firebase ID Token
const verifyIdToken = async (idToken) => {
  try {
    // In development mode without service account, use a simplified verification
    if (process.env.NODE_ENV === 'development' && 
        !process.env.FIREBASE_SERVICE_ACCOUNT_PATH && 
        !process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      logger.warn('⚠️ Firebase Admin SDK not fully configured - using simplified verification for development');
      
      // Decode the token without verification (development only)
      // In production, you MUST have proper Firebase Admin credentials
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid ID token format');
      }
      
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        
        // Basic validation
        if (!payload.email || (!payload.uid && !payload.user_id && !payload.sub)) {
          throw new Error('Token missing required fields');
        }
        
        // More lenient check for development - accept tokens from the configured project
        const projectId = firebaseConfig.projectId;
        if (payload.aud && !payload.aud.includes(projectId) && 
            payload.iss && !payload.iss.includes(projectId)) {
          logger.warn('Token from different project, accepting in development mode');
        }
        
        return {
          uid: payload.uid || payload.user_id || payload.sub,
          email: payload.email,
          name: payload.name || payload.display_name || payload.email?.split('@')[0],
          email_verified: payload.email_verified || false
        };
      } catch (parseError) {
        logger.error('Failed to parse ID token:', { error: parseError.message });
        throw new Error('Invalid token structure');
      }
    }
    
    // Production mode - require proper Firebase Admin initialization
    if (!isInitialized) {
      initializeFirebaseAdmin();
    }
    
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    logger.error('Firebase ID token verification failed:', { error: error.message });
    throw error;
  }
};

// Get user by UID
const getUserByUid = async (uid) => {
  try {
    if (!isInitialized) {
      initializeFirebaseAdmin();
    }
    
    const userRecord = await admin.auth().getUser(uid);
    return userRecord;
  } catch (error) {
    logger.error('Failed to get Firebase user:', { error: error.message });
    throw error;
  }
};

module.exports = {
  initializeFirebaseAdmin,
  verifyIdToken,
  getUserByUid,
  admin
};
