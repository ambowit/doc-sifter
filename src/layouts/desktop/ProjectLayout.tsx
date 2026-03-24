import { useState, useCallback, useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useProject, setCurrentProjectId } from "@/hooks/useProjects";
import {
  Upload,
  Sparkles,
  FileText,
  Settings,
  HelpCircle,
  ChevronRight,
  LogOut,
  User,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  LayoutTemplate,
  BookMarked,
  ArrowLeft,
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
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { motion, AnimatePresence } from "framer-motion";
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

function BrandLogo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-shrink-0">
        <BrandLogoSvg className="h-10 w-auto" />
      </div>
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <span className="font-semibold text-sm text-foreground whitespace-nowrap">DD Organizer</span>
            <span className="block text-[10px] text-muted-foreground tracking-wide whitespace-nowrap">
              尽职调查文档整理
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ProjectLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { profile, signOut, isLoading: authLoading } = useAuth();
  const { data: project, isLoading: projectLoading } = useProject(projectId);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Sync projectId from URL to localStorage
  useEffect(() => {
    if (projectId) {
      setCurrentProjectId(projectId);
    }
  }, [projectId]);

  const navigation = [
    { name: "模板指纹", href: `/project/${projectId}/template`, icon: LayoutTemplate },
    { name: "数据室文件", href: `/project/${projectId}/upload`, icon: Upload },
    { name: "定义管理", href: `/project/${projectId}/definitions`, icon: BookMarked },
    { name: "AI智能分析", href: `/project/${projectId}/mapping`, icon: Sparkles },
    { name: "报告预览", href: `/project/${projectId}/preview`, icon: FileText },
  ];

  const secondaryNav = [
    { name: "设置", href: "/settings", icon: Settings },
    { name: "帮助", href: "/help", icon: HelpCircle },
  ];

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("[ProjectLayout] Sign out error:", error);
      setIsSigningOut(false);
    }
  }, [signOut, isSigningOut, navigate]);

  const getBreadcrumbs = () => {
    const breadcrumbs = [
      { name: "项目列表", href: "/" },
    ];

    if (project) {
      breadcrumbs.push({ name: project.name, href: `/project/${projectId}/template` });
    } else if (projectId) {
      breadcrumbs.push({ name: "加载中...", href: "#" });
    }

    const routeNames: Record<string, string> = {
      template: "模板指纹",
      upload: "数据室文件",
      mapping: "AI智能分析",
      definitions: "定义管理",
      preview: "报告预览",
    };

    const pathSegments = location.pathname.split("/").filter(Boolean);
    // Path is /project/:projectId/page, so the page is at index 2
    const page = pathSegments[2];
    if (page && routeNames[page]) {
      breadcrumbs.push({
        name: routeNames[page],
        href: `/project/${projectId}/${page}`,
      });
    }

    return breadcrumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  const getInitials = (name: string | null) => {
    if (!name) return "U";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? 64 : 240 }}
        transition={{ duration: 0.2, ease: "easeInOut" }}
        className="flex-shrink-0 bg-surface-subtle border-r border-border flex flex-col relative"
      >
        {/* Collapse Toggle Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className={cn(
                "absolute -right-3 top-16 z-10 w-6 h-6 p-0 rounded-full",
                "bg-background border border-border shadow-sm",
                "hover:bg-accent hover:border-accent"
              )}
            >
              {isCollapsed ? (
                <PanelLeft className="w-3.5 h-3.5" />
              ) : (
                <PanelLeftClose className="w-3.5 h-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {isCollapsed ? "展开侧边栏" : "收起侧边栏"}
          </TooltipContent>
        </Tooltip>

        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-border">
          <BrandLogo collapsed={isCollapsed} />
        </div>

        {/* Back to Projects */}
        <div className="px-2 pt-3 pb-1">
          {isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate("/")}
                  className="w-full justify-center px-0 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">返回项目列表</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground text-[13px] px-2"
            >
              <ArrowLeft className="w-4 h-4" />
              返回项目列表
            </Button>
          )}
        </div>

        {/* Current Project Name */}
        {!isCollapsed && (
          <div className="px-4 py-2 border-b border-border">
            {projectLoading ? (
              <Skeleton className="h-4 w-28" />
            ) : project ? (
              <div className="text-[12px] text-muted-foreground truncate" title={project.name}>
                <span className="font-medium text-foreground">{project.name}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Main Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-1">
          {!isCollapsed && (
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">
              功能模块
            </div>
          )}
          {navigation.map((item, index) => {
            const isActive = location.pathname === item.href;
            const Icon = item.icon;

            const navItem = (
              <NavLink
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-2 py-2 text-[13px] rounded transition-all",
                  isActive
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-foreground hover:bg-accent hover:text-accent-foreground",
                  isCollapsed && "justify-center px-0"
                )}
              >
                {!isCollapsed && (
                  <span
                    className={cn(
                      "w-5 h-5 rounded flex items-center justify-center text-[11px] font-mono font-medium flex-shrink-0",
                      isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {index + 1}
                  </span>
                )}
                <Icon className={cn("w-4 h-4 flex-shrink-0", isCollapsed && "w-5 h-5")} />
                {!isCollapsed && <span className="truncate">{item.name}</span>}
              </NavLink>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={item.name}>
                  <TooltipTrigger asChild>{navItem}</TooltipTrigger>
                  <TooltipContent side="right">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-muted-foreground">{index + 1}</span>
                      {item.name}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            }

            return navItem;
          })}
        </nav>

        {/* Secondary Navigation */}
        <div className="px-2 py-4 border-t border-border">
          {secondaryNav.map((item) => {
            const Icon = item.icon;

            const navItem = (
              <NavLink
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-2 py-2 text-[13px] text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors",
                  isCollapsed && "justify-center px-0"
                )}
              >
                <Icon className={cn("w-4 h-4 flex-shrink-0", isCollapsed && "w-5 h-5")} />
                {!isCollapsed && <span>{item.name}</span>}
              </NavLink>
            );

            if (isCollapsed) {
              return (
                <Tooltip key={item.name}>
                  <TooltipTrigger asChild>{navItem}</TooltipTrigger>
                  <TooltipContent side="right">{item.name}</TooltipContent>
                </Tooltip>
              );
            }

            return navItem;
          })}
        </div>

        {/* User Profile Section */}
        <div className="px-2 py-3 border-t border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "w-full flex items-center gap-3 px-2 py-2 rounded hover:bg-accent transition-colors text-left",
                  isCollapsed && "justify-center px-0"
                )}
              >
                <Avatar className={cn("flex-shrink-0", isCollapsed ? "w-9 h-9" : "w-8 h-8")}>
                  <AvatarImage src={profile?.avatarUrl || undefined} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {getInitials(profile?.fullName)}
                  </AvatarFallback>
                </Avatar>
                {!isCollapsed && (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-foreground truncate">
                        {profile?.fullName || profile?.email || "用户"}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className={cn("text-[10px] px-1.5 py-0", profile?.role && roleColors[profile.role])}
                        >
                          {profile?.role ? roleLabels[profile.role] || profile.role : "用户"}
                        </Badge>
                      </div>
                    </div>
                    <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isCollapsed ? "center" : "end"} className="w-56">
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

        {/* Version Info */}
        {!isCollapsed && (
          <div className="px-4 py-2 border-t border-border">
            <div className="text-[10px] text-muted-foreground">
              <span className="font-mono">v1.0.0</span>
              <span className="mx-2">·</span>
              <span>严格证据模式</span>
            </div>
          </div>
        )}
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Breadcrumb Header */}
        <header className="h-14 flex items-center px-6 border-b border-border bg-background">
          <nav className="flex items-center text-[13px]">
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.href}-${index}`} className="flex items-center">
                {index > 0 && (
                  <ChevronRight className="w-4 h-4 mx-1 text-muted-foreground" />
                )}
                {index === breadcrumbs.length - 1 ? (
                  <span className="text-foreground font-medium">{crumb.name}</span>
                ) : (
                  <NavLink
                    to={crumb.href}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {crumb.name}
                  </NavLink>
                )}
              </span>
            ))}
          </nav>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto min-h-0 relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
