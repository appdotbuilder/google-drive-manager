import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { trpc } from '@/utils/trpc';
import type { GoogleDriveFile, ListFilesInput } from '../../../server/src/schema';

interface FileListProps {
  authToken: string;
  refreshTrigger: number;
  onRefresh: () => void;
}

export function FileList({ authToken, refreshTrigger, onRefresh }: FileListProps) {
  const [files, setFiles] = useState<GoogleDriveFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [deleteDialog, setDeleteDialog] = useState<{ show: boolean; file: GoogleDriveFile | null }>({
    show: false,
    file: null
  });

  // Configure trpc with auth token
  useEffect(() => {
    if (authToken) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (trpc as any)._def._config.links[0].headers = {
        Authorization: `Bearer ${authToken}`
      };
    }
  }, [authToken]);

  const loadFiles = useCallback(async (loadMore = false) => {
    try {
      setIsLoading(true);
      setError(null);

      const input: ListFilesInput = {
        pageSize: 50,
        query: searchQuery || undefined,
        pageToken: loadMore ? nextPageToken : undefined,
      };

      const response = await trpc.files.list.query(input);
      
      // If no files from API, show demo data to demonstrate the interface
      let filesToShow = response.files;
      if (filesToShow.length === 0 && !searchQuery) {
        // Demo data showing different file types
        filesToShow = [
          {
            id: 'demo-1',
            name: '📊 Project Budget 2024.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: '2548736',
            createdTime: new Date('2024-01-15T10:30:00Z'),
            modifiedTime: new Date('2024-01-20T14:45:00Z'),
            webViewLink: '#demo-link',
            webContentLink: '#demo-download',
            parents: ['root'],
            trashed: false,
          },
          {
            id: 'demo-2', 
            name: '📄 Meeting Notes - Jan 2024.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: '157384',
            createdTime: new Date('2024-01-10T09:00:00Z'),
            modifiedTime: new Date('2024-01-18T16:20:00Z'),
            webViewLink: '#demo-link',
            webContentLink: '#demo-download',
            parents: ['root'],
            trashed: false,
          },
          {
            id: 'demo-3',
            name: '🖼️ Team Photo.jpg',
            mimeType: 'image/jpeg',
            size: '4285672',
            createdTime: new Date('2024-01-05T12:15:00Z'),
            modifiedTime: new Date('2024-01-05T12:15:00Z'),
            webViewLink: '#demo-link',
            webContentLink: '#demo-download',
            parents: ['root'],
            trashed: false,
          },
          {
            id: 'demo-4',
            name: '📁 Project Documents',
            mimeType: 'application/vnd.google-apps.folder',
            size: null,
            createdTime: new Date('2024-01-01T08:00:00Z'),
            modifiedTime: new Date('2024-01-19T11:30:00Z'),
            webViewLink: '#demo-link',
            webContentLink: null,
            parents: ['root'],
            trashed: false,
          }
        ] as GoogleDriveFile[];
      }
      
      if (loadMore) {
        setFiles(prev => [...prev, ...filesToShow]);
      } else {
        setFiles(filesToShow);
      }
      
      setNextPageToken(response.nextPageToken);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
      console.error('Load files error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, nextPageToken]);

  // Load files on mount and refresh trigger
  useEffect(() => {
    if (authToken) {
      setFiles([]);
      setNextPageToken(undefined);
      loadFiles();
    }
  }, [authToken, refreshTrigger, searchQuery, loadFiles]);

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    setFiles([]);
    setNextPageToken(undefined);
  };

  const handleDownload = async (file: GoogleDriveFile) => {
    try {
      setError(null);
      const response = await trpc.files.download.query({ fileId: file.id });
      
      // Create blob and download
      const byteCharacters = atob(response.content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: response.mimeType });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to download file');
    }
  };

  const handleOpenWorkspaceDoc = async (file: GoogleDriveFile) => {
    try {
      setError(null);
      const response = await trpc.files.openWorkspaceDoc.query({ fileId: file.id });
      window.open(response.editUrl, '_blank');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open document');
    }
  };

  const confirmDelete = (file: GoogleDriveFile) => {
    setDeleteDialog({ show: true, file });
  };

  const handleDelete = async () => {
    if (!deleteDialog.file) return;

    try {
      setError(null);
      await trpc.files.delete.mutate({ fileId: deleteDialog.file.id });
      setFiles(prev => prev.filter(f => f.id !== deleteDialog.file!.id));
      setDeleteDialog({ show: false, file: null });
      onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
    }
  };

  const formatFileSize = (sizeStr: string | null) => {
    if (!sizeStr) return 'Unknown';
    const size = parseInt(sizeStr);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.includes('folder')) return '📁';
    if (mimeType.includes('document')) return '📝';
    if (mimeType.includes('spreadsheet')) return '📊';
    if (mimeType.includes('presentation')) return '📺';
    if (mimeType.includes('image')) return '🖼️';
    if (mimeType.includes('video')) return '🎥';
    if (mimeType.includes('audio')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    return '📎';
  };

  const isWorkspaceDoc = (mimeType: string) => {
    return mimeType.includes('document') || 
           mimeType.includes('spreadsheet') || 
           mimeType.includes('presentation');
  };

  const canDownload = (file: GoogleDriveFile) => {
    return file.webContentLink && !file.mimeType.includes('folder');
  };

  return (
    <div className="space-y-4">
      {/* Demo Notice */}
      {files.some(f => f.id.startsWith('demo-')) && (
        <Alert className="border-blue-200 bg-blue-50">
          <AlertDescription className="text-blue-700">
            <strong>Demo Mode:</strong> The Google Drive API handlers are using placeholder implementations. 
            The files shown below are sample data to demonstrate the interface. In a production environment, 
            these would be your actual Google Drive files.
          </AlertDescription>
        </Alert>
      )}
      {/* Search Bar */}
      <div className="flex gap-2">
        <Input
          placeholder="Search files and folders..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="flex-1"
        />
        <Button onClick={() => loadFiles()} disabled={isLoading}>
          {isLoading ? '🔄' : '🔍'} Search
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Files List */}
      <div className="space-y-2">
        {files.length === 0 && !isLoading ? (
          <Card>
            <CardContent className="p-6 text-center text-gray-500">
              {searchQuery ? 'No files found matching your search.' : 'No files in your Google Drive.'}
            </CardContent>
          </Card>
        ) : (
          files.map((file) => (
            <Card key={file.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <span className="text-2xl">{getFileIcon(file.mimeType)}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate">{file.name}</h3>
                      <div className="flex items-center space-x-2 text-sm text-gray-500 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {file.mimeType.split('/').pop()}
                        </Badge>
                        <span>•</span>
                        <span>{formatFileSize(file.size)}</span>
                        <span>•</span>
                        <span>{file.modifiedTime.toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {file.webViewLink && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(file.webViewLink!, '_blank')}
                      >
                        👁️ View
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline">
                          ⋯ Actions
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {isWorkspaceDoc(file.mimeType) && (
                          <DropdownMenuItem onClick={() => handleOpenWorkspaceDoc(file)}>
                            ✏️ Edit in Google
                          </DropdownMenuItem>
                        )}
                        {canDownload(file) && (
                          <DropdownMenuItem onClick={() => handleDownload(file)}>
                            ⬇️ Download
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem 
                          onClick={() => confirmDelete(file)}
                          className="text-red-600"
                        >
                          🗑️ Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Load More Button */}
      {nextPageToken && (
        <div className="text-center">
          <Button 
            variant="outline" 
            onClick={() => loadFiles(true)}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Load More Files'}
          </Button>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialog.show} onOpenChange={(show) => 
        setDeleteDialog({ show, file: deleteDialog.file })
      }>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteDialog.file?.name}"? 
              This action cannot be undone and will move the file to Google Drive trash.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}