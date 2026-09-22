/**
 * API 模块统一导出
 *
 * 调用方只需 import { xxx } from "@/api";
 */

// 认证模块
export { loginApi, registerApi } from "./modules/auth";

// 用户模块
export {
  getUserProfile,
  updateProfile,
  changePassword,
  uploadAvatar,
  getDeepSeekKeyStatus,
  saveDeepSeekKey,
  deleteDeepSeekKey,
  testDeepSeekKey,
  getSiliconFlowKeyStatus,
  saveSiliconFlowKey,
  deleteSiliconFlowKey,
  testSiliconFlowKey,
} from "./modules/user";

// 个人知识库模块（RAG）
export {
  uploadKnowledgeApi,
  askKnowledgeStream,
  downloadKnowledgeTemplate,
  downloadKnowledgeFile,
  getKnowledgeFileInfoApi,
  deleteKnowledgeFileApi,
  importKnowledgeFromFile,
  listKnowledgeDocuments,
  deleteKnowledgeDocument,
  parseTextToEntriesApi,
  batchImportEntries,
} from "./modules/knowledge";
export type {
  KnowledgeAskHandlers,
  DownloadResult,
  ParseTextResult,
  KnowledgeFileInfoResult,
} from "./modules/knowledge";

// 职位发现模块（ReAct Agent）
export { recommendJobsStream } from "./modules/jobs";
export type { JobIntent, JobRecommendHandlers } from "./modules/jobs";

// 求职画像模块（P5 Memory）
export { getJobProfileApi, saveJobProfileApi } from "./modules/jobs";

// Token 工具函数
export { getToken, setToken, removeToken } from "./client";

// 类型导出（使用 type 关键字做类型擦除优化）
export type {
  ApiResponse,
  ApiSuccessResponse,
  ApiErrorResponse,
  AuthResult,
  UserProfile,
  UpdateProfileParams,
  ChangePasswordParams,
  AvatarResult,
  DeepSeekKeyStatus,
  DeepSeekKeyTestResult,
  SiliconFlowKeyStatus,
  SiliconFlowKeyTestResult,
  LoginParams,
  RegisterParams,
  RetrievedChunk,
  UploadResult,
  KnowledgeDocument,
  ImportResult,
  KnowledgeEntry,
  JobProfile,
  JobRecommendation,
  JobRecommendationItem,
  TraceEvent,
} from "./types";

// 枚举和常量导出
export { ErrorCode, ERROR_MESSAGES } from "./types";
