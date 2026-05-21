'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bell, CheckCircle, AlertCircle, Info, Gift, TrendingUp, Clock, Check } from 'lucide-react';

export interface Notification {
  id: string;
  type: 'success' | 'warning' | 'info' | 'gift' | 'profit';
  title: string;
  message: string;
  time: string;
  read: boolean;
}

interface NotificationCenterProps {
  notifications?: Notification[];
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
}

const defaultNotifications: Notification[] = [
  { id: '1', type: 'profit', title: '收益到账', message: '您的Token存储包已到期，收益 +¥500 已到账', time: '5分钟前', read: false },
  { id: '2', type: 'gift', title: '能量值赠送', message: '您的直推会员购买成功，获得 50 能量值奖励', time: '1小时前', read: false },
  { id: '3', type: 'info', title: '新产品上架', message: 'Token存储包已更新，快去查看吧', time: '2小时前', read: true },
  { id: '4', type: 'warning', title: '能量值不足', message: '您的能量值余额不足，请及时充值', time: '1天前', read: true },
  { id: '5', type: 'success', title: '流转成功', message: '您购买的产品已成功流转', time: '2天前', read: true },
];

const typeConfig = {
  success: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/20' },
  warning: { icon: AlertCircle, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/20' },
  gift: { icon: Gift, color: 'text-purple-400', bg: 'bg-purple-500/20' },
  profit: { icon: TrendingUp, color: 'text-orange-400', bg: 'bg-orange-500/20' },
};

export function NotificationCenter({ 
  notifications = defaultNotifications, 
  onMarkRead,
  onMarkAllRead 
}: NotificationCenterProps) {
  const [localNotifications, setLocalNotifications] = useState(notifications);
  
  const unreadCount = localNotifications.filter(n => !n.read).length;
  
  const handleMarkRead = (id: string) => {
    setLocalNotifications(prev => 
      prev.map(n => n.id === id ? { ...n, read: true } : n)
    );
    onMarkRead?.(id);
  };
  
  const handleMarkAllRead = () => {
    setLocalNotifications(prev => prev.map(n => ({ ...n, read: true })));
    onMarkAllRead?.();
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-gray-400 hover:text-white">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 bg-red-500 text-white text-xs">
              {unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 bg-slate-800 border-slate-700 p-0" align="end">
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center justify-between">
            <h4 className="text-white font-medium">消息通知</h4>
            {unreadCount > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs text-blue-400 hover:text-blue-300"
                onClick={handleMarkAllRead}
              >
                全部已读
              </Button>
            )}
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {localNotifications.length === 0 ? (
            <div className="p-8 text-center">
              <Bell className="w-10 h-10 text-gray-500 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">暂无消息</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {localNotifications.map((notification) => {
                const config = typeConfig[notification.type];
                const Icon = config.icon;
                return (
                  <div 
                    key={notification.id} 
                    className={`p-3 hover:bg-slate-700/50 cursor-pointer transition-colors ${!notification.read ? 'bg-slate-700/30' : ''}`}
                    onClick={() => handleMarkRead(notification.id)}
                  >
                    <div className="flex gap-3">
                      <div className={`w-8 h-8 rounded-full ${config.bg} flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`w-4 h-4 ${config.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-medium truncate">{notification.title}</p>
                          {!notification.read && (
                            <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-gray-400 text-xs mt-0.5 line-clamp-2">{notification.message}</p>
                        <p className="text-gray-500 text-xs mt-1 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {notification.time}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="p-3 border-t border-slate-700">
          <Button variant="outline" className="w-full border-slate-600 text-gray-300 hover:text-white" size="sm">
            查看全部消息
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
