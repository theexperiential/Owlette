'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { EyeIcon, EyeOffIcon } from 'lucide-react';

interface AccountSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountSettingsDialog({ open, onOpenChange }: AccountSettingsDialogProps) {
  const { user, updateUserProfile, updatePassword } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);

  // Password change state
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Parse existing display name when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && user?.displayName) {
      const names = user.displayName.split(' ');
      if (names.length >= 2) {
        setFirstName(names[0]);
        setLastName(names.slice(1).join(' '));
      } else {
        setFirstName(names[0]);
        setLastName('');
      }
    } else if (!isOpen) {
      // Reset form when closing
      setFirstName('');
      setLastName('');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordError('');
      setShowPasswordSection(false);
    }
    onOpenChange(isOpen);
  };

  const validatePassword = (): boolean => {
    setPasswordError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required');
      return false;
    }

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return false;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return false;
    }

    if (newPassword === currentPassword) {
      setPasswordError('New password must be different from current password');
      return false;
    }

    return true;
  };

  const handleSave = async () => {
    setLoading(true);
    setPasswordError('');

    try {
      // Always update profile if name fields are filled
      if (firstName || lastName) {
        await updateUserProfile(firstName, lastName);
      }

      // Update password if password section is shown and fields are filled
      if (showPasswordSection && (currentPassword || newPassword || confirmPassword)) {
        if (!validatePassword()) {
          setLoading(false);
          return;
        }
        await updatePassword(currentPassword, newPassword);
        // Clear password fields after successful update
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowPasswordSection(false);
      }

      onOpenChange(false);
    } catch (error) {
      // Error already handled by AuthContext with toast
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-800 text-white">
        <DialogHeader>
          <DialogTitle className="text-white">Account Settings</DialogTitle>
          <DialogDescription className="text-slate-400">
            Update your account information
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="settings-firstName" className="text-white">First Name</Label>
              <Input
                id="settings-firstName"
                type="text"
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="border-slate-700 bg-slate-900 text-white"
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-lastName" className="text-white">Last Name</Label>
              <Input
                id="settings-lastName"
                type="text"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="border-slate-700 bg-slate-900 text-white"
                disabled={loading}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-white">Email</Label>
            <Input
              type="email"
              value={user?.email || ''}
              className="border-slate-700 bg-slate-900 text-slate-400"
              disabled
              readOnly
            />
            <p className="text-xs text-slate-500">Email cannot be changed</p>
          </div>

          {/* Password Change Section */}
          <Separator className="bg-slate-700" />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-white">Change Password</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowPasswordSection(!showPasswordSection);
                  setPasswordError('');
                  if (showPasswordSection) {
                    setCurrentPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                  }
                }}
                className="h-8 cursor-pointer text-xs text-blue-400 hover:text-blue-300 hover:bg-slate-700"
                disabled={loading}
              >
                {showPasswordSection ? 'Cancel' : 'Update Password'}
              </Button>
            </div>

            {showPasswordSection && (
              <div className="space-y-3 rounded-md border border-slate-700 bg-slate-900/50 p-4">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword" className="text-white">Current Password</Label>
                  <div className="relative">
                    <Input
                      id="currentPassword"
                      type={showCurrentPassword ? 'text' : 'password'}
                      placeholder="Enter current password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="border-slate-700 bg-slate-900 pr-10 text-white"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-white"
                      disabled={loading}
                    >
                      {showCurrentPassword ? (
                        <EyeOffIcon className="h-4 w-4" />
                      ) : (
                        <EyeIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-white">New Password</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="border-slate-700 bg-slate-900 pr-10 text-white"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-white"
                      disabled={loading}
                    >
                      {showNewPassword ? (
                        <EyeOffIcon className="h-4 w-4" />
                      ) : (
                        <EyeIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">Must be at least 6 characters</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-white">Confirm New Password</Label>
                  <div className="relative">
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="border-slate-700 bg-slate-900 pr-10 text-white"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-white"
                      disabled={loading}
                    >
                      {showConfirmPassword ? (
                        <EyeOffIcon className="h-4 w-4" />
                      ) : (
                        <EyeIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {passwordError && (
                  <div className="rounded-md bg-red-900/20 border border-red-800 p-3">
                    <p className="text-sm text-red-400">{passwordError}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white"
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
