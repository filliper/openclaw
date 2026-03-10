import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/feishu";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { downloadMessageResourceFeishu } from "./media.js";
import {
  createFeishuToolClient,
  resolveAnyEnabledFeishuToolsConfig,
  resolveFeishuToolAccount,
} from "./tool-account.js";

const FeishuAttachmentDownloadSchema = Type.Object({
  message_id: Type.String({
    description: "飞书消息 ID",
  }),
  file_key: Type.String({
    description: "文件 key（从消息中获取）",
  }),
  type: Type.Union([Type.Literal("image"), Type.Literal("file")], {
    description: "资源类型：image 或 file",
  }),
  account_id: Type.Optional(Type.String({
    description: "可选的飞书账户 ID",
  })),
});

export function registerFeishuAttachmentDownloadTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_attachment_download: No config available, skipping");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_attachment_download: No Feishu accounts configured, skipping");
    return;
  }

  const toolsCfg = resolveAnyEnabledFeishuToolsConfig(accounts);
  if (!toolsCfg.chat) {
    api.logger.debug?.("feishu_attachment_download: chat tools not enabled, skipping");
    return;
  }

  api.registerTool((ctx) => {
    const defaultAccountId = ctx.agentAccountId;

    return {
      name: "feishu_attachment_download",
      label: "Feishu Attachment Download",
      description:
        "下载飞书聊天消息中的附件（视频、文件、图片等）。需要提供消息 ID 和文件 key。",
      parameters: FeishuAttachmentDownloadSchema,
      async execute(_toolCallId, params) {
        const p = params as {
          message_id: string;
          file_key: string;
          type: "image" | "file";
          account_id?: string;
        };

        try {
          const accountInfo = resolveFeishuToolAccount({
            api,
            executeParams: { accountId: p.account_id },
            defaultAccountId,
          });

          const client = createFeishuToolClient({
            api,
            executeParams: { accountId: p.account_id },
            defaultAccountId,
          });

          const result = await downloadMessageResourceFeishu({
            cfg: api.config,
            messageId: p.message_id,
            fileKey: p.file_key,
            type: p.type,
            accountId: p.account_id || defaultAccountId,
          });

          // Save to temp file and return path
          const tmpDir = await api.runtime.getTempDir();
          const fileName = `feishu_attachment_${Date.now()}_${p.file_key.slice(-8)}`;
          const filePath = `${tmpDir}/${fileName}`;

          await api.runtime.writeFile(filePath, result.buffer);

          return {
            content: [
              {
                type: "text",
                text: `✅ 附件下载成功\n文件：${filePath}\n大小：${result.buffer.length} bytes`,
              },
            ],
            details: {
              success: true,
              filePath,
              size: result.buffer.length,
              contentType: result.contentType,
              accountId: accountInfo.accountId,
            },
          };
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `❌ 下载失败：${errorMsg}`,
              },
            ],
            details: {
              success: false,
              error: errorMsg,
            },
          };
        }
      },
    };
  });
}
