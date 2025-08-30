import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
// Input component not needed in this file
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/utils/trpc';
import type { UploadFileInput } from '../../../server/src/schema';

interface FileUploadProps {
  authToken: string;
  onUploadSuccess: () => void;
}

interface FileWithPreview {
  file: File;
  id: string;
  preview?: string;
}

export function FileUpload({ authToken, onUploadSuccess }: FileUploadProps) {
  const [selectedFiles, setSelectedFiles] = useState<FileWithPreview[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Configure trpc with auth token
  useEffect(() => {
    if (authToken) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (trpc as any)._def._config.links[0].headers = {
        Authorization: `Bearer ${authToken}`
      };
    }
  }, [authToken]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const filesWithPreview: FileWithPreview[] = files.map(file => {
      const id = Math.random().toString(36).substring(2, 15);
      let preview: string | undefined;

      // Create preview for images
      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file);
      }

      return { file, id, preview };
    });

    setSelectedFiles(prev => [...prev, ...filesWithPreview]);
    setError(null);
    setSuccess(null);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (id: string) => {
    setSelectedFiles(prev => {
      const filtered = prev.filter(f => f.id !== id);
      // Cleanup preview URLs
      prev.forEach(f => {
        if (f.id === id && f.preview) {
          URL.revokeObjectURL(f.preview);
        }
      });
      return filtered;
    });
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix to get just base64
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎥';
    if (type.startsWith('audio/')) return '🎵';
    if (type.includes('pdf')) return '📄';
    if (type.includes('document') || type.includes('text')) return '📝';
    if (type.includes('spreadsheet') || type.includes('excel')) return '📊';
    if (type.includes('presentation') || type.includes('powerpoint')) return '📺';
    if (type.includes('zip') || type.includes('archive')) return '📦';
    return '📎';
  };

  const uploadFiles = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setError(null);
    setSuccess(null);
    setUploadProgress(0);

    try {
      let completed = 0;
      
      for (const fileWithPreview of selectedFiles) {
        const { file } = fileWithPreview;
        
        // Convert file to base64
        const base64Content = await fileToBase64(file);
        
        const uploadInput: UploadFileInput = {
          name: file.name,
          mimeType: file.type,
          content: base64Content,
        };

        const uploadResponse = await trpc.files.upload.mutate(uploadInput);
        
        completed++;
        setUploadProgress((completed / selectedFiles.length) * 100);
        
        // Note: The backend handler is using a stub implementation
        console.log('Upload response (stub):', uploadResponse);
      }

      setSuccess(`Demo: Files would be uploaded to Google Drive in production! (${selectedFiles.length} file(s) processed)`);
      setSelectedFiles([]);
      onUploadSuccess();

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload files');
      console.error('Upload error:', err);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = Array.from(e.dataTransfer.files);
    const filesWithPreview: FileWithPreview[] = files.map(file => {
      const id = Math.random().toString(36).substring(2, 15);
      let preview: string | undefined;

      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file);
      }

      return { file, id, preview };
    });

    setSelectedFiles(prev => [...prev, ...filesWithPreview]);
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="space-y-6">
      {/* Demo Notice */}
      <Alert className="border-blue-200 bg-blue-50">
        <AlertDescription className="text-blue-700">
          <strong>Demo Mode:</strong> File upload uses a placeholder implementation. 
          In production, files would be uploaded directly to your Google Drive account.
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-200 bg-green-50">
          <AlertDescription className="text-green-700">{success}</AlertDescription>
        </Alert>
      )}

      {/* File Drop Zone */}
      <Card 
        className="border-dashed border-2 hover:border-blue-400 transition-colors cursor-pointer"
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <CardContent className="p-8 text-center">
          <div className="space-y-4">
            <div className="text-4xl">📁</div>
            <div>
              <h3 className="text-lg font-medium">Drop files here or click to browse</h3>
              <p className="text-gray-500 mt-1">
                Support for all file types. Maximum file size varies by Google Drive limits.
              </p>
            </div>
            <Button variant="outline" type="button">
              Choose Files
            </Button>
          </div>
        </CardContent>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-medium">
              Selected Files ({selectedFiles.length})
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Cleanup preview URLs
                selectedFiles.forEach(f => {
                  if (f.preview) URL.revokeObjectURL(f.preview);
                });
                setSelectedFiles([]);
              }}
            >
              Clear All
            </Button>
          </div>

          <div className="grid gap-3">
            {selectedFiles.map((fileWithPreview) => (
              <Card key={fileWithPreview.id} className="p-4">
                <div className="flex items-center space-x-3">
                  {fileWithPreview.preview ? (
                    <img
                      src={fileWithPreview.preview}
                      alt={fileWithPreview.file.name}
                      className="w-12 h-12 object-cover rounded"
                    />
                  ) : (
                    <div className="w-12 h-12 flex items-center justify-center text-2xl">
                      {getFileIcon(fileWithPreview.file.type)}
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate">{fileWithPreview.file.name}</h4>
                    <div className="flex items-center space-x-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {fileWithPreview.file.type || 'Unknown'}
                      </Badge>
                      <span className="text-sm text-gray-500">
                        {formatFileSize(fileWithPreview.file.size)}
                      </span>
                    </div>
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeFile(fileWithPreview.id)}
                    disabled={isUploading}
                  >
                    Remove
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          {isUploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Uploading files...</span>
                <span>{Math.round(uploadProgress)}%</span>
              </div>
              <Progress value={uploadProgress} className="w-full" />
            </div>
          )}

          <Button
            onClick={uploadFiles}
            disabled={isUploading || selectedFiles.length === 0}
            className="w-full"
            size="lg"
          >
            {isUploading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Uploading {selectedFiles.length} file(s)...
              </>
            ) : (
              <>
                ⬆️ Upload {selectedFiles.length} file(s) to Google Drive
              </>
            )}
          </Button>
        </div>
      )}

      <div className="text-xs text-gray-500 space-y-1">
        <p>• Files are uploaded directly to your Google Drive root folder</p>
        <p>• Large files may take longer to upload</p>
        <p>• Google Drive storage limits apply</p>
      </div>
    </div>
  );
}