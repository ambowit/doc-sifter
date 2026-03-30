-- 为 files 表启用 Realtime，支持前端实时订阅文件状态变更
ALTER PUBLICATION supabase_realtime ADD TABLE files;
