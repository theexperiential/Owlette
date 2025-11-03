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
import { doc, getDoc, setDoc } from 'firebase/firestore';
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

  useEffect(() => {
    if (!auth || !db) {
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);

      if (user) {
        // User is logged in - set session cookie
        setSessionCookie(user.uid);

        // Fetch user role from Firestore
        if (db) {
          try {
            const userDocRef = doc(db, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);

            if (userDoc.exists()) {
              const userData = userDoc.data();
              setRole(userData.role || 'user');
            } else {
              // Create user document if it doesn't exist (new user)
              await setDoc(userDocRef, {
                email: user.email,
                role: 'user',
                sites: [],
                createdAt: new Date(),
              });
              setRole('user');
            }
          } catch (error) {
            console.error('Error fetching user role:', error);
            setRole('user'); // Default to 'user' on error
          }
        } else {
          setRole('user'); // Default if db not configured
        }
      } else {
        // User is logged out - clear session cookie and reset role
        clearSessionCookie();
        setRole('user');
      }

      setLoading(false);
    });

    return unsubscribe;
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
      if (!auth) {
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
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    updateUserProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
