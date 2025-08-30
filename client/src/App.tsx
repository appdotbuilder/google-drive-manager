import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/utils/trpc';
import { FileList } from '@/components/FileList';
import { FileUpload } from '@/components/FileUpload';
import { ApiKeyManager } from '@/components/ApiKeyManager';
import type { UserContext } from '../../server/src/schema';

function App() {
  const [user, setUser] = useState<UserContext | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Check for existing session on mount
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const userData = localStorage.getItem('user_data');
    
    if (token && userData) {
      setAuthToken(token);
      setUser(JSON.parse(userData));
    }
    setIsLoading(false);
  }, []);

  const handleGoogleLogin = async () => {
    try {
      setError(null);
      const response = await trpc.auth.getAuthUrl.query();
      // Redirect to Google OAuth
      window.location.href = response.authUrl;
    } catch (err) {
      setError('Failed to initiate Google authentication');
      console.error('Auth error:', err);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');
    setAuthToken(null);
    setUser(null);
  };

  const triggerRefresh = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Handle OAuth callback from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');

    if (error) {
      setError(`Authentication failed: ${error}`);
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (code && !authToken) {
      const handleCallback = async () => {
        try {
          setIsLoading(true);
          setError(null);
          
          const response = await trpc.auth.callback.mutate({ code });
          
          // Store auth data
          localStorage.setItem('auth_token', response.accessToken);
          
          // Transform User to UserContext
          const userContext: UserContext = {
            userId: response.user.id,
            googleId: response.user.google_id,
            email: response.user.email,
          };
          
          localStorage.setItem('user_data', JSON.stringify(userContext));
          
          setAuthToken(response.accessToken);
          setUser(userContext);
          
          // Clean URL
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (err) {
          setError('Failed to complete authentication');
          console.error('Callback error:', err);
        } finally {
          setIsLoading(false);
        }
      };

      handleCallback();
    }
  }, [authToken]);

  // Update trpc client with auth token
  useEffect(() => {
    if (authToken) {
      // Configure trpc client with auth header
      // Configure trpc client with auth header
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (trpc as any)._def._config.links[0].headers = {
        Authorization: `Bearer ${authToken}`
      };
    }
  }, [authToken]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || !authToken) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold text-gray-800">
              📁 Google Drive Manager
            </CardTitle>
            <p className="text-gray-600 mt-2">
              Securely manage your Google Drive files with our powerful interface
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-3">
              <Button 
                onClick={handleGoogleLogin} 
                className="w-full bg-blue-600 hover:bg-blue-700"
                size="lg"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </Button>
              
              <div className="text-xs text-gray-500 text-center">
                We'll securely access your Google Drive to manage your files
              </div>
            </div>

            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <h3 className="font-semibold text-blue-800 mb-2">✨ Features</h3>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Browse and manage Google Drive files</li>
                <li>• Upload files directly to Drive</li>
                <li>• Download and edit documents</li>
                <li>• RESTful API for developers</li>
                <li>• Secure OAuth authentication</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-semibold text-gray-900">
                📁 Google Drive Manager
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <Badge variant="outline" className="hidden sm:flex">
                {user.email}
              </Badge>
              <Button 
                variant="outline" 
                onClick={handleLogout}
                size="sm"
              >
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Demo Notice */}
        <Alert className="border-amber-200 bg-amber-50 mb-6">
          <AlertDescription className="text-amber-800">
            <strong>🚀 Demo Application:</strong> This application demonstrates Google Drive integration with both 
            web interface and RESTful API. Backend handlers use placeholder implementations to show the complete 
            user experience. In production, these would connect to the actual Google Drive API with proper authentication and file operations.
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="files" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
            <TabsTrigger value="files">📂 File Manager</TabsTrigger>
            <TabsTrigger value="upload">⬆️ Upload</TabsTrigger>
            <TabsTrigger value="api">🔑 API Keys</TabsTrigger>
          </TabsList>

          <TabsContent value="files" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Your Google Drive Files</CardTitle>
                <p className="text-sm text-gray-600">
                  Browse, download, and manage your Google Drive files
                </p>
              </CardHeader>
              <CardContent>
                <FileList 
                  authToken={authToken}
                  refreshTrigger={refreshTrigger}
                  onRefresh={triggerRefresh}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="upload" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Upload Files</CardTitle>
                <p className="text-sm text-gray-600">
                  Upload new files to your Google Drive
                </p>
              </CardHeader>
              <CardContent>
                <FileUpload 
                  authToken={authToken}
                  onUploadSuccess={triggerRefresh}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="api" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>API Keys</CardTitle>
                <p className="text-sm text-gray-600">
                  Generate API keys for programmatic access to your Google Drive
                </p>
              </CardHeader>
              <CardContent>
                <ApiKeyManager 
                  authToken={authToken}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default App;