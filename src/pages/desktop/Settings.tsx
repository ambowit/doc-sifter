import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ReportLanguage, ReportLanguageLabels, type ReportLanguageType } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import {
  User,
  Building2,
  Bell,
  Shield,
  Palette,
  FileText,
  Save,
  Loader2,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

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

export default function Settings() {
  const { profile, updateProfile, hasRole } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const [fullName, setFullName] = useState(profile?.fullName || "");
  const [organization, setOrganization] = useState(profile?.organization || "");

  // Notification settings
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [projectUpdates, setProjectUpdates] = useState(true);
  const [reportGenerated, setReportGenerated] = useState(true);

  // Report settings
  const [defaultLanguage, setDefaultLanguage] = useState<ReportLanguageType>(ReportLanguage.ZH);
  const [strictMode, setStrictMode] = useState(true);
  const [autoSave, setAutoSave] = useState(true);

  const isAdmin = hasRole("admin");

  const getInitials = (name: string | null) => {
    if (!name) return "U";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await updateProfile({ fullName, organization });
      toast.success("个人信息已更新");
    } catch (error) {
      toast.error("保存失败", {
        description: error instanceof Error ? error.message : "未知错误",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSavePreferences = () => {
    // In a real app, these would be saved to backend
    toast.success("偏好设置已保存");
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">设置</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          管理您的账户设置和应用偏好
        </p>
      </div>

      <div className="space-y-6">
        {/* Profile Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-lg">个人信息</CardTitle>
            </div>
            <CardDescription>管理您的个人资料和账户信息</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Avatar & Role */}
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16">
                <AvatarImage src={profile?.avatarUrl || undefined} />
                <AvatarFallback className="bg-primary text-primary-foreground text-lg">
                  {getInitials(profile?.fullName)}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="font-medium text-foreground">
                  {profile?.fullName || profile?.email || "用户"}
                </div>
                <div className="text-[13px] text-muted-foreground">{profile?.email}</div>
                <Badge
                  variant="secondary"
                  className={cn("mt-1 text-[11px]", profile?.role && roleColors[profile.role])}
                >
                  {profile?.role ? roleLabels[profile.role] || profile.role : "用户"}
                </Badge>
              </div>
            </div>

            <Separator />

            {/* Edit Profile Form */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[13px]">姓名</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="输入您的姓名"
                  className="text-[13px]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[13px]">
                  <Building2 className="w-3.5 h-3.5 inline mr-1" />
                  所属机构
                </Label>
                <Input
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="输入机构名称"
                  className="text-[13px]"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveProfile} disabled={isSaving} className="gap-2">
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    保存更改
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Appearance Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-lg">外观设置</CardTitle>
            </div>
            <CardDescription>自定义应用的外观和主题</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Label className="text-[13px]">主题模式</Label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setTheme("light")}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors",
                    theme === "light"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <Sun className="w-6 h-6" />
                  <span className="text-[13px] font-medium">浅色</span>
                </button>
                <button
                  onClick={() => setTheme("dark")}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors",
                    theme === "dark"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <Moon className="w-6 h-6" />
                  <span className="text-[13px] font-medium">深色</span>
                </button>
                <button
                  onClick={() => setTheme("system")}
                  className={cn(
                    "flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors",
                    theme === "system"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30"
                  )}
                >
                  <Monitor className="w-6 h-6" />
                  <span className="text-[13px] font-medium">跟随系统</span>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-lg">通知设置</CardTitle>
            </div>
            <CardDescription>配置您希望接收的通知类型</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between py-2">
              <div>
                <Label className="text-[13px] font-medium">邮件通知</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  通过邮件接收重要更新
                </p>
              </div>
              <Switch checked={emailNotifications} onCheckedChange={setEmailNotifications} />
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2">
              <div>
                <Label className="text-[13px] font-medium">项目更新</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  项目状态变更时通知我
                </p>
              </div>
              <Switch checked={projectUpdates} onCheckedChange={setProjectUpdates} />
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2">
              <div>
                <Label className="text-[13px] font-medium">报告生成完成</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  报告生成完成后通知我
                </p>
              </div>
              <Switch checked={reportGenerated} onCheckedChange={setReportGenerated} />
            </div>
          </CardContent>
        </Card>

        {/* Report Preferences */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-muted-foreground" />
              <CardTitle className="text-lg">报告偏好</CardTitle>
            </div>
            <CardDescription>设置报告生成的默认选项</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[13px]">默认报告语言</Label>
                <Select value={defaultLanguage} onValueChange={(v) => setDefaultLanguage(v as ReportLanguageType)}>
                  <SelectTrigger className="text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ReportLanguage.ZH}>{ReportLanguageLabels[ReportLanguage.ZH]}</SelectItem>
                    <SelectItem value={ReportLanguage.EN}>{ReportLanguageLabels[ReportLanguage.EN]}</SelectItem>
                    <SelectItem value={ReportLanguage.ZH_EN}>{ReportLanguageLabels[ReportLanguage.ZH_EN]}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2">
              <div>
                <Label className="text-[13px] font-medium">严格证据模式（默认）</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  新项目默认开启严格证据模式
                </p>
              </div>
              <Switch checked={strictMode} onCheckedChange={setStrictMode} />
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2">
              <div>
                <Label className="text-[13px] font-medium">自动保存</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  编辑时自动保存更改
                </p>
              </div>
              <Switch checked={autoSave} onCheckedChange={setAutoSave} />
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={handleSavePreferences} variant="outline" className="gap-2">
                <Save className="w-4 h-4" />
                保存偏好
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Admin Section - Only visible to admins */}
        {isAdmin && (
          <Card className="border-purple-200 bg-purple-50/30">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-purple-600" />
                <CardTitle className="text-lg text-purple-700">管理员设置</CardTitle>
              </div>
              <CardDescription>仅管理员可见的高级设置</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-white rounded-lg border border-purple-200">
                <div className="text-[13px] font-medium text-purple-700 mb-2">团队管理</div>
                <p className="text-[12px] text-muted-foreground mb-3">
                  管理团队成员、角色和权限
                </p>
                <Button variant="outline" size="sm" className="text-purple-600 border-purple-300">
                  管理团队
                </Button>
              </div>
              <div className="p-4 bg-white rounded-lg border border-purple-200">
                <div className="text-[13px] font-medium text-purple-700 mb-2">系统日志</div>
                <p className="text-[12px] text-muted-foreground mb-3">
                  查看系统操作日志和审计记录
                </p>
                <Button variant="outline" size="sm" className="text-purple-600 border-purple-300">
                  查看日志
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
