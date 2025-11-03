'use client';

import { useState } from 'react';
import { useUserManagement } from '@/hooks/useUserManagement';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, Shield, ShieldAlert, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

/**
 * User Management Page
 *
 * Admin-only page for managing user roles and permissions.
 * Allows admins to:
 * - View all users
 * - Promote users to admin
 * - Demote admins to user
 */
export default function UserManagementPage() {
  const { users, loading, error, updateUserRole, getUserCounts } = useUserManagement();
  const { user: currentUser } = useAuth();
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);

  const counts = getUserCounts();

  const handleToggleRole = async (userId: string, currentRole: 'user' | 'admin') => {
    // Prevent user from demoting themselves
    if (userId === currentUser?.uid && currentRole === 'admin') {
      toast.error('Cannot Demote Yourself', {
        description: 'You cannot remove your own admin privileges.',
      });
      return;
    }

    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    const action = newRole === 'admin' ? 'promote' : 'demote';

    // Confirm action
    const userEmail = users.find((u) => u.uid === userId)?.email || 'this user';
    const confirmed = confirm(
      `Are you sure you want to ${action} ${userEmail} to ${newRole}?`
    );

    if (!confirmed) return;

    setUpdatingUser(userId);

    try {
      await updateUserRole(userId, newRole);
      toast.success('Role Updated', {
        description: `User has been ${action}d to ${newRole}.`,
      });
    } catch (err: any) {
      toast.error('Update Failed', {
        description: err.message || 'Failed to update user role.',
      });
    } finally {
      setUpdatingUser(null);
    }
  };

  const formatDate = (timestamp: any) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">User Management</h1>
        <p className="text-slate-400">Manage user roles and permissions</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-600 rounded-lg">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{counts.total}</p>
              <p className="text-sm text-slate-400">Total Users</p>
            </div>
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-green-600 rounded-lg">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{counts.admins}</p>
              <p className="text-sm text-slate-400">Administrators</p>
            </div>
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-slate-600 rounded-lg">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{counts.users}</p>
              <p className="text-sm text-slate-400">Regular Users</p>
            </div>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 mb-6">
          <p className="text-red-300">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <span className="ml-3 text-slate-400">Loading users...</span>
        </div>
      )}

      {/* Users Table */}
      {!loading && !error && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left p-4 text-sm font-medium text-slate-300">User</th>
                <th className="text-left p-4 text-sm font-medium text-slate-300">Role</th>
                <th className="text-left p-4 text-sm font-medium text-slate-300">Sites</th>
                <th className="text-left p-4 text-sm font-medium text-slate-300">Joined</th>
                <th className="text-right p-4 text-sm font-medium text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-400">
                    No users found
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr
                    key={user.uid}
                    className="border-b border-slate-700 hover:bg-slate-700/50 transition-colors"
                  >
                    {/* User Info */}
                    <td className="p-4">
                      <div>
                        {user.displayName && (
                          <p className="text-white font-medium">{user.displayName}</p>
                        )}
                        <p className="text-sm text-slate-400">{user.email}</p>
                        {user.uid === currentUser?.uid && (
                          <Badge className="mt-1 bg-blue-600 text-xs">You</Badge>
                        )}
                      </div>
                    </td>

                    {/* Role Badge */}
                    <td className="p-4">
                      {user.role === 'admin' ? (
                        <Badge className="bg-green-600 flex items-center gap-1 w-fit">
                          <ShieldAlert className="h-3 w-3" />
                          Administrator
                        </Badge>
                      ) : (
                        <Badge className="bg-slate-600 flex items-center gap-1 w-fit">
                          <Users className="h-3 w-3" />
                          User
                        </Badge>
                      )}
                    </td>

                    {/* Sites Count */}
                    <td className="p-4">
                      <span className="text-white">{user.sites?.length || 0}</span>
                      <span className="text-slate-400 text-sm ml-1">
                        site{user.sites?.length !== 1 ? 's' : ''}
                      </span>
                    </td>

                    {/* Join Date */}
                    <td className="p-4 text-slate-400 text-sm">
                      {formatDate(user.createdAt)}
                    </td>

                    {/* Actions */}
                    <td className="p-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleRole(user.uid, user.role)}
                        disabled={updatingUser === user.uid}
                        className="border-slate-700 bg-slate-900 text-white hover:bg-slate-700 hover:text-white cursor-pointer"
                      >
                        {updatingUser === user.uid ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                            Updating...
                          </>
                        ) : user.role === 'admin' ? (
                          'Demote to User'
                        ) : (
                          'Promote to Admin'
                        )}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Info Box */}
      {!loading && !error && users.length > 0 && (
        <div className="mt-6 bg-blue-900/30 border border-blue-700 rounded-lg p-4">
          <p className="text-blue-300 text-sm">
            <strong>Note:</strong> Administrators have full access to the admin panel and can
            manage users, upload installer versions, and configure system settings. Regular users
            can only access the dashboard and their assigned sites.
          </p>
        </div>
      )}
    </div>
  );
}
