'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { generateTOTPSecret, generateQRCode, verifyTOTP, generateBackupCodes, hashBackupCode } from '@/lib/totp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import Image from 'next/image';

export default function Setup2FAPage() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  const [secret, setSecret] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [step, setStep] = useState<'setup' | 'verify' | 'backup'>('setup');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }

    if (user && step === 'setup') {
      // Generate TOTP secret and QR code
      const newSecret = generateTOTPSecret();
      setSecret(newSecret);

      generateQRCode(user.email!, newSecret)
        .then(setQrCodeUrl)
        .catch((error) => {
          console.error('Failed to generate QR code:', error);
          toast.error('Failed to generate QR code');
        });
    }
  }, [user, loading, router, step]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!verificationCode || verificationCode.length !== 6) {
      toast.error('Please enter a 6-digit code');
      return;
    }

    setIsSubmitting(true);

    try {
      // Verify the TOTP code
      const isValid = verifyTOTP(verificationCode, secret);

      if (!isValid) {
        toast.error('Invalid code', {
          description: 'Please check your authenticator app and try again.',
        });
        setIsSubmitting(false);
        return;
      }

      // Generate backup codes
      const codes = generateBackupCodes(10);
      setBackupCodes(codes);

      // Hash backup codes for storage
      const hashedCodes = codes.map(hashBackupCode);

      // Save MFA configuration to Firestore
      if (user && db) {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, {
          mfaEnrolled: true,
          mfaSecret: secret, // TODO: Encrypt this before storing
          backupCodes: hashedCodes,
          mfaEnrolledAt: new Date(),
          requiresMfaSetup: false, // Setup complete
        });
      }

      toast.success('2FA Enabled', {
        description: 'Two-factor authentication has been enabled successfully.',
      });

      // Move to backup codes step
      setStep('backup');
    } catch (error) {
      console.error('Error enabling 2FA:', error);
      toast.error('Failed to enable 2FA');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFinish = () => {
    toast.success('Setup Complete', {
      description: 'You can now access your dashboard.',
    });
    router.push('/dashboard');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800 p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Set Up Two-Factor Authentication</CardTitle>
          <CardDescription>
            Secure your account with two-factor authentication (2FA)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'setup' && (
            <div className="space-y-6">
              <div className="text-sm text-gray-600 space-y-2">
                <p className="font-semibold">Step 1: Scan QR Code</p>
                <p>Open your authenticator app (Google Authenticator, Authy, etc.) and scan this QR code:</p>
              </div>

              {qrCodeUrl && (
                <div className="flex justify-center">
                  <Image
                    src={qrCodeUrl}
                    alt="2FA QR Code"
                    width={250}
                    height={250}
                    className="border rounded-lg"
                  />
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-600">Manual Entry Code:</p>
                <div className="flex gap-2">
                  <Input
                    value={secret}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copyToClipboard(secret)}
                  >
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-gray-500">
                  If you cannot scan the QR code, enter this code manually in your authenticator app.
                </p>
              </div>

              <div className="space-y-2">
                <Button
                  onClick={() => setStep('verify')}
                  className="w-full"
                >
                  Continue to Verification
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    await signOut();
                    toast.info('Setup Cancelled', {
                      description: 'You can complete 2FA setup when you sign in again.',
                    });
                    router.push('/login');
                  }}
                  className="w-full text-sm text-slate-400 hover:text-white"
                >
                  Cancel Setup
                </Button>
              </div>
            </div>
          )}

          {step === 'verify' && (
            <form onSubmit={handleVerify} className="space-y-6">
              <div className="text-sm text-gray-600 space-y-2">
                <p className="font-semibold">Step 2: Verify Setup</p>
                <p>Enter the 6-digit code from your authenticator app to verify:</p>
              </div>

              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="000000"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  className="text-center text-2xl font-mono tracking-widest h-16 px-4"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Button
                  type="submit"
                  disabled={isSubmitting || verificationCode.length !== 6}
                  className="w-full"
                >
                  {isSubmitting ? 'Verifying...' : 'Verify & Enable 2FA'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep('setup')}
                  disabled={isSubmitting}
                  className="w-full"
                >
                  Back
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    await signOut();
                    toast.info('Setup Cancelled', {
                      description: 'You can complete 2FA setup when you sign in again.',
                    });
                    router.push('/login');
                  }}
                  disabled={isSubmitting}
                  className="w-full text-sm text-slate-400 hover:text-white"
                >
                  Cancel Setup
                </Button>
              </div>
            </form>
          )}

          {step === 'backup' && (
            <div className="space-y-6">
              <div className="text-sm text-gray-600 space-y-2">
                <p className="font-semibold text-red-600">Step 3: Save Backup Codes</p>
                <p>
                  Save these backup codes in a secure location. You can use them to access your account
                  if you lose access to your authenticator app.
                </p>
                <p className="text-red-600 font-semibold">
                  These codes will only be shown once!
                </p>
              </div>

              <div className="bg-gray-50 border rounded-lg p-4">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {backupCodes.map((code, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <span className="text-gray-500">{index + 1}.</span>
                      <span className="font-bold">{code}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyToClipboard(backupCodes.join('\n'))}
                  className="w-full"
                >
                  Copy All Codes
                </Button>
                <Button
                  onClick={handleFinish}
                  className="w-full"
                >
                  I've Saved My Codes
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
