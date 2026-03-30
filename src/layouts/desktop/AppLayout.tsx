import { useState, useCallback } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  Settings,
  HelpCircle,
  LogOut,
  User,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import BrandLogoSvg from "@/components/desktop/BrandLogoSvg";

const roleLabels: Record<string, string> = {
  admin: "管理员",
  senior_lawyer: "高级律师",
  junior_lawyer: "初级律师",
  lawyer: "律师",
  assistant: "助理",
};

const roleColors: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700",
  senior_lawyer: "bg-blue-100 text-blue-700",
  junior_lawyer: "bg-emerald-100 text-emerald-700",
  lawyer: "bg-blue-100 text-blue-700",
  assistant: "bg-amber-100 text-amber-700",
};

export default function AppLayout() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("[AppLayout] Sign out error:", error);
      setIsSigningOut(false);
    }
  }, [signOut, isSigningOut, navigate]);

  const getInitials = (name: string | null) => {
    if (!name) return "U";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top Bar */}
      <header className="h-14 flex items-center justify-between px-6 border-b border-border bg-background flex-shrink-0">
        {/* Left: Brand */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/")}>
          <div className="flex-shrink-0">
            <BrandLogoSvg className="h-10 w-auto" />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-base text-foreground leading-tight">DD Organizer</span>
            <span className="text-xs text-muted-foreground tracking-wide leading-tight">
              尽职调查文档整理
            </span>
          </div>
        </div>

        {/* Right: Nav + User */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/settings")}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="设置"
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate("/help")}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="帮助"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* User Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded hover:bg-accent px-2 py-1.5 transition-colors">
                <Avatar className="w-7 h-7">
                  <AvatarImage src={profile?.avatarUrl || undefined} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {getInitials(profile?.fullName)}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[13px] font-medium text-foreground max-w-[100px] truncate">
                  {profile?.fullName || "用户"}
                </span>
                {profile?.role && (
                  <Badge
                    variant="secondary"
                    className={cn("text-[10px] px-1.5 py-0", roleColors[profile.role])}
                  >
                    {roleLabels[profile.role] || profile.role}
                  </Badge>
                )}
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-2">
                <p className="text-sm font-medium">{profile?.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
                {profile?.organization && (
                  <p className="text-xs text-muted-foreground mt-1">{profile.organization}</p>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2" onClick={() => navigate("/settings")}>
                <User className="w-4 h-4" />
                <span>个人设置</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-destructive cursor-pointer"
                onSelect={(e) => {
                  e.preventDefault();
                  handleSignOut();
                }}
                disabled={isSigningOut}
              >
                <LogOut className="w-4 h-4" />
                <span>{isSigningOut ? "退出中..." : "退出登录"}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Page Content */}
      <main className="flex-1 overflow-auto min-h-0">
        <Outlet />
      </main>
    </div>
  );
}
