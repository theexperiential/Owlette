'use client';

import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useInstallerVersion } from '@/hooks/useInstallerVersion';
import { toast } from 'sonner';

/**
 * DownloadButton Component
 *
 * Public download button for the agent installer.
 * Displays in the dashboard header for all authenticated users.
 *
 * Features:
 * - Shows latest version in tooltip
 * - Downloads installer when clicked
 * - Loading state while fetching
 * - Error handling with user feedback
 */
export default function DownloadButton() {
  const { version, downloadUrl, isLoading, error } = useInstallerVersion();

  const handleDownload = () => {
    if (!downloadUrl) {
      toast.error('Download Unavailable', {
        description: 'Installer download URL is not available.',
      });
      return;
    }

    try {
      // Open download URL in new tab
      window.open(downloadUrl, '_blank');
      toast.success('Download Started', {
        description: `Downloading Owlette v${version}`,
      });
    } catch (err) {
      toast.error('Download Failed', {
        description: 'Failed to start download. Please try again.',
      });
    }
  };

  // Don't show button if there's an error or no version available
  if (error || (!isLoading && !version)) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            disabled={isLoading || !downloadUrl}
            className="flex items-center gap-2 hover:bg-slate-800 cursor-pointer text-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="hidden md:inline">Loading...</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span className="hidden md:inline">Download</span>
              </>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="bg-slate-800 border-slate-700 text-white"
        >
          {isLoading ? (
            <p>Loading version info...</p>
          ) : (
            <p>Download Owlette v{version}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
