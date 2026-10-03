import path from "path";
import { databasePath } from "./runtime-config.cjs";

/**
 * 上传文件（病假证明/打卡照片/工单附件等）统一存到数据目录下的 uploads 子目录，
 * 和数据文件 data.db 放在一起持久化到宿主机（容器挂载卷），
 * 容器重建 / 重新部署不会丢文件。
 */
export const uploadsDir = path.join(path.dirname(databasePath), "uploads");
