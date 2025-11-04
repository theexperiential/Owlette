'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { setSessionCookie, clearSessionCookie } from '@/lib/sessionManager';
import { handleError } from '@/lib/errorHandler';
import { toast } from 'sonner';

type UserRole = 'user' | 'admin';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  role: UserRole;
  isAdmin: boolean;
  userSites: string[]; // Sites the user has access to
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, firstName?: string, lastName?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUserProfile: (firstName: string, lastName: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  role: 'user',
  isAdmin: false,
  userSites: [],
  signIn: async () => {},
  signUp: async () => {},
  signInWithGoogle: async () => {},
  signOut: async () => {},
  updateUserProfile: async () => {},
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>('user');
  const [userSites, setUserSites] = useState<string[]>([]);

  useEffect(() => {
    if (!auth || !db) {
      setLoading(false);
      return;
    }

    let userDocUnsubscribe: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);

      // Clean up previous user document listener
      if (userDocUnsubscribe) {
        userDocUnsubscribe();
        userDocUnsubscribe = null;
      }

      if (user) {
        // User is logged in - set session cookie
        setSessionCookie(user.uid);

        // Listen to user document for real-time updates
        if (db) {
          const userDocRef = doc(db, 'users', user.uid);

          // Set up real-time listener for user document
          userDocUnsubscribe = onSnapshot(
            userDocRef,
            async (docSnap) => {
              if (docSnap.exists()) {
                const userData = docSnap.data();
                console.log('✅ User document updated, role:', userData.role);
                console.log('📋 User sites array:', userData.sites);
                setRole(userData.role || 'user');
                setUserSites(userData.sites || []);
                setLoading(false);
              } else {
                // Create user document if it doesn't exist (new user)
                console.log('⚠️ User document missing, creating now...');
                try {
                  await setDoc(userDocRef, {
                    email: user.email,
                    role: 'user',
                    sites: [],
                    createdAt: new Date(),
                  });
                  console.log('✅ User document created by listener');
                  // Don't set loading to false yet - wait for the listener to fire again
                } catch (firestoreError: any) {
                  console.error('❌ Listener failed to create document:', firestoreError);
                  console.error('Error code:', firestoreError.code);
                  setRole('user');
                  setUserSites([]);
                  setLoading(false);
                }
              }
            },
            (error) => {
              console.error('Error listening to user document:', error);
              setRole('user');
              setUserSites([]);
              setLoading(false);
            }
          );
        } else {
          setRole('user');
          setUserSites([]);
          setLoading(false);
        }
      } else {
        // User is logged out - clear session cookie and reset role
        clearSessionCookie();
        setRole('user');
        setUserSites([]);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (userDocUnsubscribe) {
        userDocUnsubscribe();
      }
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      if (!auth) {
        const error = new Error('Firebase authentication is not configured. Please check your environment variables.');
        toast.error('Authentication Error', {
          description: 'Firebase is not configured properly. Please contact support.',
        });
        throw error;
      }

      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      const friendlyMessage = handleError(error);
      toast.error('Sign In Failed', {
        description: friendlyMessage,
      });
      throw error; // Re-throw so calling component can handle it
    }
  };

  const signUp = async (email: string, password: string, firstName?: string, lastName?: string) => {
    try {
      if (!auth || !db) {
        const error = new Error('Firebase authentication is not configured. Please check your environment variables.');
        toast.error('Authentication Error', {
          description: 'Firebase is not configured properly. Please contact support.',
        });
        throw error;
      }

      const userCredential = await createUserWithEmailAndPassword(auth, email, password);

      // Set display name if first/last name provided
      if (firstName || lastName) {
        const displayName = [firstName, lastName].filter(Boolean).join(' ');
        await updateProfile(userCredential.user, { displayName });
      }

      // Immediately create user document in Firestore
      const userDocRef = doc(db, 'users', userCredential.user.uid);
      try {
        await setDoc(userDocRef, {
          email: userCredential.user.email,
          role: 'user',
          sites: [],
          createdAt: new Date(),
          displayName: [firstName, lastName].filter(Boolean).join(' ') || '',
        });
        console.log('✅ User document created in Firestore:', userCredential.user.uid);
      } catch (firestoreError: any) {
        console.error('❌ Failed to create user document:', firestoreError);
        console.error('Error code:', firestoreError.code);
        console.error('Error message:', firestoreError.message);
        // Don't throw - let the user continue even if Firestore fails
        // The onAuthStateChanged listener will retry
      }

      toast.success('Account Created', {
        description: 'Your account has been created successfully. You can now sign in.',
      });
    } catch (error: any) {
      const friendlyMessage = handleError(error);
      toast.error('Sign Up Failed', {
        description: friendlyMessage,
      });
      throw error; // Re-throw so calling component can handle it
    }
  };

  const signInWithGoogle = async () => {
    try {
      if (!auth) {
        const error = new Error('Firebase authentication is not configured. Please check your environment variables.');
        toast.error('Authentication Error', {
          description: 'Firebase is not configured properly. Please contact support.',
        });
        throw error;
      }

      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      // Don't show toast for popup closed by user
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        throw error;
      }

      const friendlyMessage = handleError(error);
      toast.error('Google Sign In Failed', {
        description: friendlyMessage,
      });
      throw error; // Re-throw so calling component can handle it
    }
  };

  const signOut = async () => {
    try {
      if (!auth) {
        const error = new Error('Firebase authentication is not configured.');
        toast.error('Authentication Error', {
          description: 'Firebase is not configured properly.',
        });
        throw error;
      }

      await firebaseSignOut(auth);
      toast.success('Signed Out', {
        description: 'You have been signed out successfully.',
      });
    } catch (error: any) {
      const friendlyMessage = handleError(error);
      toast.error('Sign Out Failed', {
        description: friendlyMessage,
      });
      throw error; // Re-throw so calling component can handle it
    }
  };

  const updateUserProfile = async (firstName: string, lastName: string) => {
    try {
      if (!auth?.currentUser) {
        const error = new Error('No user is currently signed in.');
        toast.error('Update Failed', {
          description: 'You must be signed in to update your profile.',
        });
        throw error;
      }

      const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();

      if (!displayName) {
        const error = new Error('Please provide at least a first or last name.');
        toast.error('Update Failed', {
          description: 'Please provide at least a first or last name.',
        });
        throw error;
      }

      await updateProfile(auth.currentUser, { displayName });

      // Force a refresh of the user object
      setUser({ ...auth.currentUser });

      toast.success('Profile Updated', {
        description: 'Your profile has been updated successfully.',
      });
    } catch (error: any) {
      const friendlyMessage = handleError(error);
      toast.error('Update Failed', {
        description: friendlyMessage,
      });
      throw error;
    }
  };

  const value = {
    user,
    loading,
    role,
    isAdmin: role === 'admin',
    userSites,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    updateUserProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
