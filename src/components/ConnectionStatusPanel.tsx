import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Twitch, Youtube, CheckCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';

const ConnectionStatusPanel: React.FC = () => {
  const { isTwitchAuthed, isYoutubeAuthed } = useAuthStore();
  const connections = useChatStore((state) => state.connections);
  
  // Count active connections by type
  const twitchConnections = connections.filter(conn => conn.type === 'twitch' && conn.isConnected);
  const youtubeConnections = connections.filter(conn => conn.type === 'youtube' && conn.isConnected);
  
  // Get connection names for tooltips
  const twitchChannels = twitchConnections.map(conn => conn.channelName).join(', ');
  const youtubeChannels = youtubeConnections.map(conn => conn.channelName).join(', ');

  return (
    <Card className="bg-card/50 backdrop-blur-sm border-stream-accent/30 mb-4">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-medium">Connection Status</h2>
          
          <div className="flex items-center gap-4">
            {/* Twitch Status */}
            <div className="flex items-center gap-2" title={twitchChannels ? `Connected to: ${twitchChannels}` : ''}>
              <Twitch size={18} className="text-purple-400" />
              <span className="text-sm">Twitch:</span>
              
              {!isTwitchAuthed ? (
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-400/30">
                  Not Authenticated
                </Badge>
              ) : twitchConnections.length > 0 ? (
                <Badge className="bg-green-500/20 text-green-400 border-green-400/30 gap-1">
                  <CheckCircle size={14} />
                  <span>Connected ({twitchConnections.length})</span>
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-400/30">
                  Authenticated
                </Badge>
              )}
            </div>
            
            {/* YouTube Status */}
            <div className="flex items-center gap-2" title={youtubeChannels ? `Connected to: ${youtubeChannels}` : ''}>
              <Youtube size={18} className="text-red-400" />
              <span className="text-sm">YouTube:</span>
              
              {!isYoutubeAuthed ? (
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-400/30">
                  Not Authenticated
                </Badge>
              ) : youtubeConnections.length > 0 ? (
                <Badge className="bg-green-500/20 text-green-400 border-green-400/30 gap-1">
                  <CheckCircle size={14} />
                  <span>Connected ({youtubeConnections.length})</span>
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-400/30">
                  Authenticated
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ConnectionStatusPanel;