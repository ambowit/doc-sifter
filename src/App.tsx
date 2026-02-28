import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
  Outlet,
  ScrollRestoration,
} from "react-router-dom";
import { ThemeProvider } from "next-themes";
import NotFound from "@/pages/NotFound";
import AppLayout from "@/layouts/desktop/AppLayout";
import Dashboard from "@/pages/desktop/Dashboard";
import FileUpload from "@/pages/desktop/FileUpload";
import TemplateFingerprint from "@/pages/desktop/TemplateFingerprint";
import ChapterMapping from "@/pages/desktop/ChapterMapping";
import Definitions from "@/pages/desktop/Definitions";
import ReportPreview from "@/pages/desktop/ReportPreview";
import Login from "@/pages/desktop/Login";
import Register from "@/pages/desktop/Register";
import AuthCallback from "@/pages/desktop/AuthCallback";
import Settings from "@/pages/desktop/Settings";
import Help from "@/pages/desktop/Help";
import ProtectedRoute from "@/components/desktop/ProtectedRoute";
import { AuthProvider } from "@/hooks/useAuth";

// Export queryClient for use in auth hooks (cache clearing)
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

function RootLayout() {
  return (
    <AuthProvider>
      <Outlet />
      <ScrollRestoration />
    </AuthProvider>
  );
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootLayout />}>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      
      {/* Protected routes */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/upload" element={<FileUpload />} />
        <Route path="/template" element={<TemplateFingerprint />} />
        <Route path="/mapping" element={<ChapterMapping />} />
        <Route path="/definitions" element={<Definitions />} />
        <Route path="/preview" element={<ReportPreview />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/help" element={<Help />} />
      </Route>
      
      <Route path="*" element={<NotFound />} />
    </Route>
  )
);

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Sonner />
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
