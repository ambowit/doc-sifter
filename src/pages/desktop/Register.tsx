import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import BrandLogoSvg from "@/components/desktop/BrandLogoSvg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { FileText, Loader2, Mail, Lock, Eye, EyeOff, User, Building2 } from "lucide-react";

interface FormErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

export default function Register() {
  const navigate = useNavigate();
  const { signUpWithEmail, signInWithGoogle, isLoading: authLoading } = useAuth();
  
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
    organization: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});

  const validateForm = () => {
    const newErrors: FormErrors = {};
    
    if (!formData.fullName.trim()) {
      newErrors.fullName = "请输入姓名";
    } else if (formData.fullName.trim().length < 2) {
      newErrors.fullName = "姓名至少2个字符";
    }
    
    if (!formData.email.trim()) {
      newErrors.email = "请输入邮箱地址";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "请输入有效的邮箱地址";
    }
    
    if (!formData.password) {
      newErrors.password = "请输入密码";
    } else if (formData.password.length < 6) {
      newErrors.password = "密码至少6位";
    }
    
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = "请确认密码";
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "两次输入的密码不一致";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const updateField = (field: keyof typeof formData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const handleEmailRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!validateForm()) return;
    
    setIsSubmitting(true);
    try {
      await signUpWithEmail(
        formData.email,
        formData.password,
        formData.fullName,
        formData.organization || undefined
      );
      toast.success("注册成功！请查收验证邮件");
      navigate("/login");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "注册失败";
      if (errorMessage.includes("already registered")) {
        toast.error("该邮箱已被注册");
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleRegister = async () => {
    try {
      await signInWithGoogle();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Google 注册失败";
      toast.error(errorMessage);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary p-12 flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 text-primary-foreground">
            <BrandLogoSvg className="h-10 w-auto" />
            <span className="text-xl font-semibold tracking-tight">DD Organizer</span>
          </div>
        </div>
        
        <div className="space-y-6">
          <h1 className="text-4xl font-bold text-primary-foreground leading-tight">
            加入专业法律人士<br />的首选工具
          </h1>
          <ul className="space-y-4 text-primary-foreground/80">
            <li className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary-foreground/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm font-medium text-primary-foreground">1</span>
              </div>
              <span>AI 智能解析报告模板与尽调文件结构</span>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary-foreground/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm font-medium text-primary-foreground">2</span>
              </div>
              <span>拖拽式章节映射，一目了然掌握证据覆盖</span>
            </li>
            <li className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary-foreground/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm font-medium text-primary-foreground">3</span>
              </div>
              <span>每段内容可追溯，AI 绝不编造事实</span>
            </li>
          </ul>
        </div>
        
        <div className="text-primary-foreground/60 text-sm">
          &copy; 2026 DD Organizer. 保留所有权利。
        </div>
      </div>

      {/* Right panel - Register form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-[400px] space-y-6">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 justify-center mb-6">
            <BrandLogoSvg className="h-10 w-auto" />
            <span className="text-xl font-semibold tracking-tight">DD Organizer</span>
          </div>

          <div className="space-y-2 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">创建账户</h2>
            <p className="text-muted-foreground">注册以开始使用 DD Organizer</p>
          </div>

          {/* Google OAuth */}
          <Button
            variant="outline"
            className="w-full h-11 gap-3"
            onClick={handleGoogleRegister}
            disabled={isSubmitting}
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
            使用 Google 账号注册
          </Button>

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-4 text-sm text-muted-foreground">
              或
            </span>
          </div>

          {/* Email register form */}
          <form onSubmit={handleEmailRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="fullName">姓名 *</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="fullName"
                  type="text"
                  placeholder="张三"
                  value={formData.fullName}
                  onChange={(e) => updateField("fullName", e.target.value)}
                  className={`pl-10 h-11 ${errors.fullName ? "border-destructive" : ""}`}
                  disabled={isSubmitting}
                />
              </div>
              {errors.fullName && (
                <p className="text-sm text-destructive">{errors.fullName}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">邮箱地址 *</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  value={formData.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  className={`pl-10 h-11 ${errors.email ? "border-destructive" : ""}`}
                  disabled={isSubmitting}
                />
              </div>
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="organization">律所/公司名称（选填）</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="organization"
                  type="text"
                  placeholder="XX 律师事务所"
                  value={formData.organization}
                  onChange={(e) => updateField("organization", e.target.value)}
                  className="pl-10 h-11"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码 *</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="至少6位"
                  value={formData.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  className={`pl-10 pr-10 h-11 ${errors.password ? "border-destructive" : ""}`}
                  disabled={isSubmitting}
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

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认密码 *</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="再次输入密码"
                  value={formData.confirmPassword}
                  onChange={(e) => updateField("confirmPassword", e.target.value)}
                  className={`pl-10 pr-10 h-11 ${errors.confirmPassword ? "border-destructive" : ""}`}
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">{errors.confirmPassword}</p>
              )}
            </div>

            <Button type="submit" className="w-full h-11" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  注册中...
                </>
              ) : (
                "创建账户"
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            已有账户？{" "}
            <Link
              to="/login"
              className="text-foreground font-medium hover:underline"
            >
              立即登录
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
