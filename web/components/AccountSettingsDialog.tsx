'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface AccountSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AccountSettingsDialog({ open, onOpenChange }: AccountSettingsDialogProps) {
  const { user, updateUserProfile } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);

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
    }
    onOpenChange(isOpen);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateUserProfile(firstName, lastName);
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
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-700 text-white"
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
