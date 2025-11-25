import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, User, Bell, Search, FileText, AlertTriangle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import axios from "axios";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface EmailNotification {
  id: string;
  subject: string;
  from: string;
  date: string;
  attachments: number;
  timestamp: string | Date;
}

interface WhatsAppNotification {
  id: string;
  from: string;
  body: string;
  timestamp: string | Date;
  hasMedia: boolean;
  attachments: Array<{
    filename: string;
    mimetype: string;
  }>;
}

interface Notification {
  id: string;
  title: string;
  message: string;
  timestamp: Date;
  type: 'document' | 'alert' | 'system' | 'email' | 'whatsapp';
  read: boolean;
  emailData?: EmailNotification;
  whatsappData?: WhatsAppNotification;
}

interface NavigationProps {
  isLoggedIn?: boolean;
  userRole?: string;
}

export const Navigation = ({ isLoggedIn = false, userRole = "" }: NavigationProps) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [demoNotifications, setDemoNotifications] = useState<Notification[]>([]);
  const location = useLocation();

  // Initialize demo notifications
  // Fetch email notifications
  // Start services when component mounts
  useEffect(() => {
        const startServices = async () => {
      try {
        // Start email service
        console.log('Starting email service...');
        await axios.post('http://localhost:3001/api/email/start');
        console.log('Email service started successfully');

            // WhatsApp service: disabled in this build to avoid QR/status logs
            console.log('WhatsApp service is disabled in the client.');
      } catch (error) {
        console.error('Failed to start services:', error);
        // Don't retry on 429 (Too Many Requests)
        if (error.response?.status === 429) {
          console.log('Rate limit exceeded. Waiting for rate limit reset...');
          return;
        }
        // Don't retry on CORS errors
        if (error.message?.includes('NetworkError')) {
          console.log('CORS error detected. Please check server configuration.');
          return;
        }
      }
    };
    startServices();
  }, []);

  // Fetch notifications
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
      // Fetch email notifications
      console.log('Fetching email notifications...');
      const emailResponse = await axios.get('http://localhost:3001/api/email/status');
      console.log('Email status response:', emailResponse.data);

      // WhatsApp status/fetch is disabled to avoid QR string in logs.
      const whatsappResponse = { data: { newMessages: [], status: 'disabled' } };

      const notifications: Notification[] = [];

        // Process email notifications
        if (emailResponse.data.newEmails?.length > 0) {
          const emailNotifications = emailResponse.data.newEmails.map((email: any) => ({
            id: email.id || Math.random().toString(36).substr(2, 9),
            title: email.subject || 'New Email',
            message: `From: ${email.from?.split('<')[0]?.trim() || 'Unknown'}`,
            timestamp: new Date(email.timestamp || email.date),
            type: 'email' as const,
            read: false,
            emailData: {
              ...email,
              timestamp: email.timestamp || email.date
            }
          }));
          notifications.push(...emailNotifications);
        }

        // Process WhatsApp notifications
        if (whatsappResponse.data.newMessages?.length > 0) {
          const whatsappNotifications = whatsappResponse.data.newMessages.map((msg: any) => ({
            id: msg.id || Math.random().toString(36).substr(2, 9),
            title: 'WhatsApp Message',
            message: `From: ${msg.from.split('@')[0]}`,
            timestamp: new Date(msg.timestamp),
            type: 'whatsapp' as const,
            read: false,
            whatsappData: msg
          }));
          notifications.push(...whatsappNotifications);
        }

        console.log('Created notifications:', notifications);

        // Update notifications state with new items
        setDemoNotifications(prev => {
          const existingNotifs = prev.filter(n => 
            !(notifications.some(newN => newN.id === n.id))
          );
          
          const newNotifs = [...notifications, ...existingNotifs];
          console.log('Final notifications state:', newNotifs);
          return newNotifs;
        });

        // Check if services need to be started
        if (!emailResponse.data.status || emailResponse.data.status === 'stopped') {
          console.log('Email service not running, starting it...');
          await axios.post('http://localhost:3001/api/email/start');
        }

        // WhatsApp service intentionally not started from the client.
      } catch (error) {
        console.error('Failed to fetch notifications:', error);
      }
    };

    // Initial fetch
    fetchNotifications();

    // Poll for new notifications every 30 seconds
    const interval = setInterval(fetchNotifications, 30000);

    return () => clearInterval(interval);
  }, []);

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read in local state
    setDemoNotifications(prev => 
      prev.map(n => n.id === notification.id ? { ...n, read: true } : n)
    );

    try {
      switch (notification.type) {
        case 'email':
          await axios.post('http://localhost:3001/api/email/clear-notifications', {
            ids: [notification.id]
          });
          
          // If notification has attachments, navigate to documents page
          if (notification.emailData?.attachments > 0) {
            // You can add navigation to documents page here if needed
            // navigate('/documents');
          }
          break;

        case 'whatsapp':
          await axios.post('http://localhost:3001/api/whatsapp/clear-notifications', {
            ids: [notification.id]
          });

          // If notification has media, navigate to documents page
          if (notification.whatsappData?.hasMedia) {
            // You can add navigation to documents page here if needed
            // navigate('/documents');
          }
          break;
      }
    } catch (error) {
      console.error(`Failed to clear ${notification.type} notification:`, error);
    }
  };

  const handleMarkAllRead = async () => {
    // Get unread notification IDs by type
    const unreadNotifications = demoNotifications.filter(n => !n.read);
    const emailIds = unreadNotifications.filter(n => n.type === 'email').map(n => n.id);
    const whatsappIds = unreadNotifications.filter(n => n.type === 'whatsapp').map(n => n.id);

    // Mark all as read in local state
    setDemoNotifications(prev => prev.map(n => ({ ...n, read: true })));

    try {
      // Clear email notifications in backend
      if (emailIds.length > 0) {
        await axios.post('http://localhost:3001/api/email/clear-notifications', {
          ids: emailIds
        });
      }

      // Clear WhatsApp notifications in backend
      if (whatsappIds.length > 0) {
        await axios.post('http://localhost:3001/api/whatsapp/clear-notifications', {
          ids: whatsappIds
        });
      }
    } catch (error) {
      console.error('Failed to clear notifications:', error);
    }
  };

  return (
    <nav className="bg-card border-b border-border shadow-soft sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Brand */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-gradient-to-br from-primary to-success rounded-lg flex items-center justify-center">
                <FileText className="w-6 h-6 text-white font-bold" />
              </div>
              <div className="ml-3">
                <div className="text-lg font-bold text-foreground">KMRL DocuMind</div>
                <div className="text-xs text-muted-foreground">Intelligent Document Management</div>
              </div>
            </div>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-6">
            {!isLoggedIn ? (
              <>
                <Link to="/" className={`transition-colors font-medium ${location.pathname === '/' ? 'text-primary' : 'text-foreground hover:text-primary'}`}>
                  Home
                </Link>
                <Link to="/features" className="text-foreground hover:text-primary transition-colors font-medium">
                  Features
                </Link>
                <Link to="/solutions" className="text-foreground hover:text-primary transition-colors font-medium">
                  Solutions
                </Link>
                <Link to="/about" className={`transition-colors font-medium ${location.pathname === '/about' ? 'text-primary' : 'text-foreground hover:text-primary'}`}>
                  About
                </Link>
                <Link to="/contact" className={`transition-colors font-medium ${location.pathname === '/contact' ? 'text-primary' : 'text-foreground hover:text-primary'}`}>
                  Contact
                </Link>
              </>
            ) : (
              <>
                <Link to="/dashboard" className={`transition-colors font-medium ${location.pathname === '/dashboard' ? 'text-primary' : 'text-foreground hover:text-primary'}`}>
                  Dashboard
                </Link>
                <Link to="/documents" className="text-foreground hover:text-primary transition-colors font-medium">
                  Documents
                </Link>
                <Link to="/analytics" className={`transition-colors font-medium ${location.pathname === '/analytics' ? 'text-primary' : 'text-foreground hover:text-primary'}`}>
                  Analytics
                </Link>
              </>
            )}
          </div>

          {/* Right Side Actions */}
          <div className="hidden md:flex items-center space-x-4">
            {!isLoggedIn ? (
              <>
                <Button variant="ghost" className="text-foreground hover:text-primary">
                  Login
                </Button>
                <Button className="btn-hero">
                  Get Started
                </Button>
              </>
            ) : (
              <>
                {/* Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search documents..."
                    className="pl-10 pr-4 py-2 border border-border rounded-lg bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent w-64"
                  />
                </div>

                {/* Notifications */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="relative">
                      <Bell className="w-5 h-5" />
                      {demoNotifications.filter(n => !n.read).length > 0 && (
                        <Badge variant="destructive" className="absolute -top-1 -right-1 px-1 min-w-5 h-5 text-xs flex items-center justify-center">
                          {demoNotifications.filter(n => !n.read).length}
                        </Badge>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80">
                    <DropdownMenuLabel className="flex items-center justify-between">
                      <span>Notifications</span>
                      {demoNotifications.length > 0 && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={handleMarkAllRead}
                          className="text-xs h-auto py-1 px-2"
                        >
                          Mark all read
                        </Button>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {demoNotifications.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground text-sm">
                        No notifications
                      </div>
                    ) : (
                      demoNotifications.map(notification => (
                        <DropdownMenuItem 
                          key={notification.id}
                          className="p-4 focus:bg-accent cursor-pointer"
                          onClick={() => handleNotificationClick(notification)}
                        >
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">
                                <div className="flex items-center gap-2">
                                {notification.type === 'email' ? (
                                  <Mail className="w-4 h-4 text-primary" />
                                ) : notification.type === 'whatsapp' ? (
                                  <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 20.15C10.57 20.15 9.11 19.76 7.82 19L7.44 18.78L4.3 19.62L5.16 16.57L4.91 16.17C4.09 14.83 3.65 13.31 3.65 11.74C3.65 7.31 7.31 3.65 12.04 3.65C14.27 3.65 16.36 4.53 17.93 6.1C19.5 7.67 20.38 9.76 20.38 11.99C20.38 16.42 16.72 20.15 12.05 20.15Z"/>
                                  </svg>
                                ) : null}
                                {notification.title}
                              </div>
                              </span>
                              {!notification.read && (
                                <Badge variant="secondary" className="h-auto py-0.5 px-1.5 text-[10px]">New</Badge>
                              )}
                              {(notification.type === 'email' && notification.emailData?.attachments > 0) && (
                                <Badge variant="outline" className="h-auto py-0.5 px-1.5 text-[10px]">
                                  {notification.emailData.attachments} attachments
                                </Badge>
                              )}
                              {(notification.type === 'whatsapp' && notification.whatsappData?.hasMedia) && (
                                <Badge variant="outline" className="h-auto py-0.5 px-1.5 text-[10px]">
                                  {notification.whatsappData.attachments.length} media
                                </Badge>
                              )}
                            </div>
                            <div className="text-muted-foreground text-xs">
                              {notification.type === 'email' ? (
                                <>From: <span className="font-medium">{notification.emailData?.from?.split('<')[0]?.trim()}</span></>
                              ) : (
                                notification.message
                              )}
                            </div>
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <span>{new Date(notification.timestamp).toLocaleString()}</span>
                              <Badge variant="secondary" className="h-4 px-1">
                                {notification.type === 'email' ? 'Email' : 
                                 notification.type === 'whatsapp' ? 'WhatsApp' : 
                                 notification.type}
                              </Badge>
                            </div>
                          </div>
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* User Profile */}
                <div className="flex items-center space-x-2">
                  <div className="text-right hidden lg:block">
                    <div className="text-sm font-medium text-foreground">Admin User</div>
                    <div className="text-xs text-muted-foreground">{userRole || "System Administrator"}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="relative">
                    <User className="w-5 h-5" />
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden">
            <Button variant="ghost" size="icon" onClick={toggleMobileMenu}>
              {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-border">
            <div className="px-2 pt-2 pb-3 space-y-1 bg-card">
              {!isLoggedIn ? (
                <>
                  <Link to="/" className="block px-3 py-2 text-foreground hover:bg-accent rounded-md">
                    Home
                  </Link>
                  <Link to="/#features" className="block px-3 py-2 text-foreground hover:bg-accent rounded-md">
                    Features
                  </Link>
                  <Link to="/#solutions" className="block px-3 py-2 text-foreground hover:bg-accent rounded-md">
                    Solutions
                  </Link>
                  <Link to="/about" className="block px-3 py-2 text-foreground hover:bg-accent rounded-md">
                    About
                  </Link>
                  <Link to="/contact" className="block px-3 py-2 text-foreground hover:bg-accent rounded-md">
                    Contact
                  </Link>
                  <div className="pt-4 flex flex-col space-y-2">
                    <Button variant="ghost" className="text-foreground">
                      Login
                    </Button>
                    <Button className="btn-hero">
                      Get Started
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Link to="/dashboard" className="block px-3 py-2 text-foreground hover:bg-accent rounded-md">
                    Dashboard
                  </Link>
                  <Link to="/documents" className="block px-3 py-2 text-foreground hover:bg-accent rounded-md">
                    Documents
                  </Link>
                  <Link to="/analytics" className="block px-3 py-2 text-foreground hover:bg-accent rounded-md">
                    Analytics
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};