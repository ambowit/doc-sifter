import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, type UserRole } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  FileText,
  Loader2,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Shield,
  Briefcase,
  GraduationCap,
  UserCog,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import BrandLogoSvg from "@/components/desktop/BrandLogoSvg";

// TODO: Re-enable production check before launch
// For testing purposes, always show test accounts
const isProduction = false;

// Test accounts with real credentials
const TEST_ACCOUNTS: Array<{
  id: string;
  role: string;
  authRole: UserRole;
  description: string;
  fullName: string;
  email: string;
  password: string;
  icon: typeof UserCog;
  color: string;
  bgColor: string;
  borderColor: string;
}> = [
    {
      id: "admin",
      role: "管理员",
      authRole: "admin",
      description: "完整权限，可管理团队和项目设置",
      fullName: "张明（管理员）",
      email: "admin@ddorganizer.test",
      password: "Test123456!",
      icon: UserCog,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
      borderColor: "border-purple-200",
    },
    {
      id: "senior",
      role: "律师",
      authRole: "senior_lawyer",
      description: "负责报告审核与最终出具",
      fullName: "李婷（高级合伙人）",
      email: "senior@ddorganizer.test",
      password: "Test123456!",
      icon: Briefcase,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      borderColor: "border-blue-200",
    },
  ];

export default function Login() {
  const navigate = useNavigate();
  const { signInWithEmail, signInWithGoogle, isLoading: authLoading, isAuthenticated } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginInProgress, setLoginInProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  // Redirect to dashboard if already authenticated
  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      console.log("[Login] User already authenticated, redirecting to dashboard");
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, authLoading, navigate]);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};

    if (!email.trim()) {
      newErrors.email = "请输入邮箱地址";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = "请输入有效的邮箱地址";
    }

    if (!password) {
      newErrors.password = "请输入密码";
    } else if (password.length < 6) {
      newErrors.password = "密码至少6位";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleEmailLogin = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      await signInWithEmail(email, password);
      toast.success("登录成功");
      // Navigation handled by useEffect watching isAuthenticated
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "登录失败";
      if (errorMessage.includes("Invalid login credentials")) {
        toast.error("邮箱或密码错误");
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Google 登录失败";
      toast.error(errorMessage);
    }
  };

  const handleTestLogin = async (account: typeof TEST_ACCOUNTS[0]) => {
    // Prevent multiple login attempts
    if (loginInProgress) {
      return;
    }

    setLoginInProgress(account.id);
    console.log("[Login] Starting test login for:", account.email);

    try {
      // Try to sign in with the test account credentials
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });

      if (signInError) {
        console.log("[Login] Sign in error:", signInError.message);

        // If user doesn't exist, try to create them first
        if (signInError.message.includes("Invalid login credentials")) {
          toast.info("正在初始化测试账号...");

          // Call edge function to initialize test users
          const { data: initData, error: initError } = await supabase.functions.invoke("init-test-users");

          if (initError) {
            console.error("[Login] Init test users error:", initError);
            toast.error("初始化测试账号失败");
            setLoginInProgress(null);
            return;
          }

          console.log("[Login] Init result:", initData);

          // Wait a bit for the user to be created
          await new Promise(resolve => setTimeout(resolve, 500));

          // Try signing in again after initialization
          const { data: retryData, error: retryError } = await supabase.auth.signInWithPassword({
            email: account.email,
            password: account.password,
          });

          if (retryError) {
            console.error("[Login] Retry login error:", retryError);
            toast.error("测试账号登录失败");
            setLoginInProgress(null);
            return;
          }

          console.log("[Login] Retry login success:", retryData.user?.email);
        } else {
          console.error("[Login] Sign in error:", signInError);
          toast.error(signInError.message);
          setLoginInProgress(null);
          return;
        }
      } else {
        console.log("[Login] Sign in success:", signInData.user?.email);
      }

      toast.success(`以${account.role}身份登录成功`);
      // Navigation is handled by the useEffect watching isAuthenticated
    } catch (error) {
      console.error("[Login] Test login error:", error);
      toast.error("登录失败，请稍后重试");
      setLoginInProgress(null);
    }
  };

  // Show loading only during initial auth check, not during login process
  if (authLoading && !isSubmitting && !loginInProgress) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary p-12 flex-col justify-between relative overflow-hidden">
        {/* Decorative background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-32 h-32 rounded-full border-2 border-primary-foreground" />
          <div className="absolute top-16 left-24 w-32 h-32 rounded-full border-2 border-primary-foreground" />
          <div className="absolute top-24 left-40 w-32 h-32 rounded-full border-2 border-primary-foreground" />
          <div className="absolute bottom-32 right-20 w-24 h-24 rounded-full border-2 border-primary-foreground" />
          <div className="absolute bottom-28 right-32 w-24 h-24 rounded-full border-2 border-primary-foreground" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 text-primary-foreground">
            <BrandLogoSvg className="w-12 h-10" color="#FFFFFF" />
            <span className="text-xl font-semibold tracking-tight">DD Organizer</span>
          </div>
        </div>

        <div className="space-y-6 relative z-10">
          <h1 className="text-4xl font-bold text-primary-foreground leading-tight">
            专业的法律尽职调查<br />文档整理助手
          </h1>
          <p className="text-primary-foreground/80 text-lg max-w-md">
            AI 驱动的文档解析与章节映射，让尽调报告撰写效率提升 10 倍。证据驱动，每段内容可追溯。
          </p>
          {/* Accent highlight */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-1 bg-[hsl(66,70%,50%)] rounded-full" />
            <span className="text-primary-foreground/70 text-sm">AI 智能解析</span>
          </div>
        </div>

        <div className="text-primary-foreground/60 text-sm relative z-10">
          &copy; 2026 DD Organizer. 保留所有权利。
        </div>
      </div>

      {/* Right panel - Login form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background overflow-auto">
        <div className="w-full max-w-[440px] space-y-6">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 justify-center mb-8">
            <BrandLogoSvg className="w-12 h-10" />
            <span className="text-xl font-semibold tracking-tight">DD Organizer</span>
          </div>

          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">欢迎回来</h2>
            <p className="text-muted-foreground">登录您的账户以继续</p>
          </div>

          {/* Demo Accounts Section - Hidden in production */}
          {!isProduction && (
            <>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[hsl(66,70%,45%)]" />
                  <span className="text-[13px] font-medium">测试账号</span>
                  <span className="text-[11px] text-muted-foreground">点击快速体验</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {TEST_ACCOUNTS.map((account, index) => {
                    const IconComponent = account.icon;
                    const isLogging = loginInProgress === account.id;

                    return (
                      <motion.button
                        key={account.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        onClick={() => handleTestLogin(account)}
                        disabled={isSubmitting || loginInProgress !== null}
                        className={cn(
                          "flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all",
                          "hover:shadow-sm hover:border-primary/30",
                          "disabled:opacity-50 disabled:cursor-not-allowed",
                          account.bgColor,
                          account.borderColor
                        )}
                      >
                        <div className={cn(
                          "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
                          "bg-white/80"
                        )}>
                          {isLogging ? (
                            <Loader2 className={cn("w-4 h-4 animate-spin", account.color)} />
                          ) : (
                            <IconComponent className={cn("w-4 h-4", account.color)} />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className={cn("text-[13px] font-medium", account.color)}>
                            {account.role}
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {account.description}
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>

              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-4 text-[12px] text-muted-foreground">
                  或使用账号登录
                </span>
              </div>
            </>
          )}

          {/* Google OAuth */}
          <Button
            variant="outline"
            className="w-full h-11 gap-3"
            onClick={handleGoogleLogin}
            disabled={isSubmitting || loginInProgress !== null}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            使用 Google 账号登录
          </Button>

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-4 text-[12px] text-muted-foreground">
              或
            </span>
          </div>

          {/* Email login form */}
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">邮箱地址</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors(prev => ({ ...prev, email: undefined }));
                  }}
                  className={`pl-10 h-11 ${errors.email ? "border-destructive" : ""}`}
                  disabled={isSubmitting || loginInProgress !== null}
                />
              </div>
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">密码</Label>
                <Link
                  to="/forgot-password"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  忘记密码？
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="输入密码"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password) setErrors(prev => ({ ...prev, password: undefined }));
                  }}
                  className={`pl-10 pr-10 h-11 ${errors.password ? "border-destructive" : ""}`}
                  disabled={isSubmitting || loginInProgress !== null}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
            </div>

            <Button type="submit" className="w-full h-11" disabled={isSubmitting || loginInProgress !== null}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  登录中...
                </>
              ) : (
                "登录"
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            还没有账户？{" "}
            <Link
              to="/register"
              className="text-foreground font-medium hover:underline"
            >
              立即注册
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
