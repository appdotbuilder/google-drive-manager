import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { trpc } from '@/utils/trpc';
// UserContext type not used in this component

interface ApiKeyManagerProps {
  authToken: string;
}

interface CreatedApiKey {
  keyName: string;
  apiKey: string;
  createdAt: Date;
}

export function ApiKeyManager({ authToken }: ApiKeyManagerProps) {
  const [keyName, setKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Configure trpc with auth token
  useEffect(() => {
    if (authToken) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (trpc as any)._def._config.links[0].headers = {
        Authorization: `Bearer ${authToken}`
      };
    }
  }, [authToken]);

  const handleCreateApiKey = async () => {
    if (!keyName.trim()) {
      setError('Please provide a name for your API key');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      
      const response = await trpc.auth.createApiKey.mutate({ keyName: keyName.trim() });
      
      setCreatedKey({
        keyName: response.keyName,
        apiKey: response.apiKey,
        createdAt: response.createdAt
      });
      
      setKeyName('');
      setShowCreateDialog(false);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage || 'Failed to create API key');
      console.error('Create API key error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // You could add a toast notification here
      alert('Copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy:', err);
      alert('Failed to copy to clipboard');
    }
  };

  const apiEndpoint = window.location.origin + '/api';

  return (
    <div className="space-y-6">
      {/* Demo Notice */}
      <Alert className="border-blue-200 bg-blue-50">
        <AlertDescription className="text-blue-700">
          <strong>Demo Mode:</strong> API key creation uses a placeholder implementation. 
          In production, secure API keys would be generated and stored in the database for programmatic access.
        </AlertDescription>
      </Alert>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Create API Key Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            🔑 Generate API Key
          </CardTitle>
          <p className="text-sm text-gray-600">
            Create API keys to access your Google Drive programmatically
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                ➕ Create New API Key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create API Key</DialogTitle>
                <DialogDescription>
                  Give your API key a descriptive name to help you remember its purpose.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-4">
                <div>
                  <Label htmlFor="keyName">API Key Name</Label>
                  <Input
                    id="keyName"
                    placeholder="e.g., Mobile App, Website Backend, etc."
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleCreateApiKey}
                    disabled={isLoading || !keyName.trim()}
                  >
                    {isLoading ? 'Creating...' : 'Create API Key'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowCreateDialog(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Created API Key Display */}
      {createdKey && (
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-800 flex items-center gap-2">
              ✅ API Key Created Successfully
            </CardTitle>
            <p className="text-sm text-green-700">
              Copy your API key now. For security reasons, you won't be able to see it again.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-green-800">API Key Name</Label>
              <div className="mt-1">
                <Badge variant="outline" className="bg-white">
                  {createdKey.keyName}
                </Badge>
              </div>
            </div>
            
            <div>
              <Label className="text-green-800">API Key</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={createdKey.apiKey}
                  readOnly
                  className="font-mono text-xs bg-white"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(createdKey.apiKey)}
                >
                  📋 Copy
                </Button>
              </div>
            </div>

            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertDescription className="text-yellow-800">
                <strong>Important:</strong> Store this API key securely. You won't be able to see it again after closing this page.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* API Documentation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            📚 API Documentation
          </CardTitle>
          <p className="text-sm text-gray-600">
            Use these endpoints to integrate Google Drive into your applications
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h4 className="font-medium mb-2">Authentication</h4>
            <p className="text-sm text-gray-600 mb-2">
              Include your API key in the <code className="bg-gray-100 px-1 rounded">X-API-Key</code> header:
            </p>
            <Textarea
              value={`X-API-Key: YOUR_API_KEY_HERE`}
              readOnly
              className="font-mono text-xs resize-none h-8"
            />
          </div>

          <div>
            <h4 className="font-medium mb-2">Base URL</h4>
            <div className="flex gap-2">
              <Input
                value={apiEndpoint}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(apiEndpoint)}
              >
                📋 Copy
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-medium">Available Endpoints</h4>
            
            <div className="space-y-3">
              <div className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-blue-100 text-blue-800">GET</Badge>
                  <code className="text-sm">/api/listFiles</code>
                </div>
                <p className="text-xs text-gray-600 mb-2">List files in Google Drive</p>
                <Textarea
                  value={`curl -X GET "${apiEndpoint}/listFiles?pageSize=10" \\
  -H "X-API-Key: YOUR_API_KEY"`}
                  readOnly
                  className="font-mono text-xs resize-none h-16"
                />
              </div>

              <div className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-green-100 text-green-800">POST</Badge>
                  <code className="text-sm">/api/uploadFile</code>
                </div>
                <p className="text-xs text-gray-600 mb-2">Upload a file to Google Drive</p>
                <Textarea
                  value={`curl -X POST "${apiEndpoint}/uploadFile" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "test.txt", "mimeType": "text/plain", "content": "SGVsbG8gV29ybGQ="}'`}
                  readOnly
                  className="font-mono text-xs resize-none h-20"
                />
              </div>

              <div className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-blue-100 text-blue-800">GET</Badge>
                  <code className="text-sm">/api/downloadFile</code>
                </div>
                <p className="text-xs text-gray-600 mb-2">Download a file from Google Drive</p>
                <Textarea
                  value={`curl -X GET "${apiEndpoint}/downloadFile?fileId=FILE_ID" \\
  -H "X-API-Key: YOUR_API_KEY"`}
                  readOnly
                  className="font-mono text-xs resize-none h-16"
                />
              </div>

              <div className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Badge className="bg-red-100 text-red-800">DELETE</Badge>
                  <code className="text-sm">/api/deleteFile</code>
                </div>
                <p className="text-xs text-gray-600 mb-2">Delete a file from Google Drive</p>
                <Textarea
                  value={`curl -X DELETE "${apiEndpoint}/deleteFile" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"fileId": "FILE_ID"}'`}
                  readOnly
                  className="font-mono text-xs resize-none h-18"
                />
              </div>
            </div>
          </div>

          <div className="bg-blue-50 p-4 rounded-lg">
            <h5 className="font-medium text-blue-800 mb-2">📝 Notes</h5>
            <ul className="text-xs text-blue-700 space-y-1">
              <li>• File content must be base64 encoded for uploads</li>
              <li>• File IDs can be obtained from the listFiles endpoint</li>
              <li>• All API responses are in JSON format</li>
              <li>• Rate limits apply according to Google Drive API quotas</li>
              <li>• API keys never expire but can be revoked by recreating them</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}