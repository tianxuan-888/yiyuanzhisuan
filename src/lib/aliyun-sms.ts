/**
 * 阿里云短信认证服务模块
 * 使用号码认证服务的 SendSmsVerifyCode API（个人用户免资质）
 * 无需企业营业执照、无需申请签名或模板
 */
import Dypnsapi from '@alicloud/dypnsapi20170525';
import { SendSmsVerifyCodeRequest } from '@alicloud/dypnsapi20170525/dist/models/SendSmsVerifyCodeRequest';
import { CheckSmsVerifyCodeRequest } from '@alicloud/dypnsapi20170525/dist/models/CheckSmsVerifyCodeRequest';
import * as OpenApi from '@alicloud/openapi-client';
import { RuntimeOptions } from '@darabonba/typescript';

// 运行时读取环境变量（修改.env.local后无需重启服务，Next.js HMR会重新加载模块）
function getEnvConfig() {
  return {
    accessKeyId: process.env.ALIYUN_SMS_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET || '',
    signName: process.env.ALIYUN_SMS_SIGN_NAME || '',
    templateCode: process.env.ALIYUN_SMS_TEMPLATE_CODE || '',
    templateCodeReset: process.env.ALIYUN_SMS_TEMPLATE_CODE_RESET || process.env.ALIYUN_SMS_TEMPLATE_CODE || '',
  };
}

// 按场景选择不同模板CODE
function getTemplateCode(scene: string): string {
  const config = getEnvConfig();
  const map: Record<string, string> = {
    register: config.templateCode,
    reset_password: config.templateCodeReset,
    forgot_password: config.templateCodeReset,
    default: config.templateCode,
  };
  return map[scene] || map['default'] || '';
}

let client: Dypnsapi | null = null;

/**
 * 获取阿里云号码认证服务客户端（单例）
 */
function getClient(): Dypnsapi {
  const config = getEnvConfig();
  if (!client) {
    const openApiConfig = new OpenApi.Config({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      endpoint: 'dypnsapi.aliyuncs.com',
    });
    client = new Dypnsapi(openApiConfig);
  }
  return client;
}

/**
 * 发送验证码短信（使用短信认证服务 SendSmsVerifyCode）
 * 阿里云自动生成验证码（##code##占位符），通过 returnVerifyCode 返回给服务端存储
 * @param phone 手机号（纯数字，如 13800000001）
 * @param scene 场景：register / reset_password / default
 * @returns 发送结果，含阿里云生成的验证码（code字段）
 */
export async function sendSmsVerifyCode(phone: string, scene: string = 'register'): Promise<{
  success: boolean;
  message: string;
  code?: string;       // 阿里云生成的验证码（ReturnVerifyCode=true时返回）
  requestId?: string;
}> {
  const config = getEnvConfig();
  const templateCode = getTemplateCode(scene);
  // 检查阿里云配置是否完整
  if (!config.accessKeyId || !config.accessKeySecret || !config.signName || !templateCode) {
    console.warn('[阿里云短信认证] 配置不完整，跳过真实发送。需要在环境变量中配置：');
    console.warn('  ALIYUN_SMS_ACCESS_KEY_ID');
    console.warn('  ALIYUN_SMS_ACCESS_KEY_SECRET');
    console.warn('  ALIYUN_SMS_SIGN_NAME（号码认证服务控制台 → 预置签名）');
    console.warn('  ALIYUN_SMS_TEMPLATE_CODE（号码认证服务控制台 → 预置模板）');
    return {
      success: true,
      message: '验证码已发送（开发模式，未实际发送短信）',
      code: undefined,  // 开发模式：由调用方自行生成验证码
    };
  }

  try {
    console.log(`[阿里云短信认证] 发送参数: phone=${phone}, signName=${config.signName}, templateCode=${templateCode}, scene=${scene}`);
    const smsClient = getClient();
    const request = new SendSmsVerifyCodeRequest({
      phoneNumber: phone,
      signName: config.signName,
      templateCode: templateCode,
      templateParam: JSON.stringify({ code: '##code##' }),  // ##code## 由阿里云自动生成验证码；赠送模板只有${code}变量，不传min
      codeType: 1,          // 纯数字验证码
      codeLength: 6,        // 6位验证码
      returnVerifyCode: true,   // 返回验证码用于存入数据库
    });

    const runtime = new RuntimeOptions({});
    const response = await smsClient.sendSmsVerifyCodeWithOptions(request, runtime);

    if (response.body?.code === 'OK') {
      const verifyCode = response.body.model?.verifyCode;
      console.log(`[阿里云短信认证] 发送成功: ${phone}, RequestId: ${response.body.requestId}, hasCode: ${!!verifyCode}`);
      return {
        success: true,
        message: '验证码已发送',
        code: verifyCode,
        requestId: response.body.requestId,
      };
    } else {
      console.error(`[阿里云短信认证] 发送失败: ${phone}, Code: ${response.body?.code}, Message: ${response.body?.message}`);
      return {
        success: false,
        message: response.body?.message || '短信发送失败',
      };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[阿里云短信认证] 发送异常:', errMsg);
    return {
      success: false,
      message: '短信发送失败，请稍后重试',
    };
  }
}

/**
 * 校验验证码（使用短信认证服务 CheckSmsVerifyCode）
 * 可选：由阿里云服务端校验，比本地校验更安全
 * @param phone 手机号
 * @param verifyCode 用户输入的验证码
 * @returns 校验结果
 */
export async function checkSmsVerifyCode(phone: string, verifyCode: string): Promise<{
  success: boolean;
  message: string;
}> {
  const config = getEnvConfig();
  if (!config.accessKeyId || !config.accessKeySecret || !config.signName) {
    // 开发模式，不校验
    return { success: true, message: '开发模式' };
  }

  try {
    const smsClient = getClient();
    const request = new CheckSmsVerifyCodeRequest({
      phoneNumber: phone,
      verifyCode: verifyCode,
      countryCode: '86',
      caseAuthPolicy: 1,  // 不区分大小写
    });

    const runtime = new RuntimeOptions({});
    const response = await smsClient.checkSmsVerifyCodeWithOptions(request, runtime);

    // 重要：Code=OK 只代表接口调用成功，不代表验证码正确
    // 验证码核验结果以 Model.VerifyResult 为准（PASS/UNKNOWN）
    if (response.body?.code === 'OK') {
      const verifyResult = response.body.model?.verifyResult;
      if (verifyResult === 'PASS') {
        return { success: true, message: '验证码校验通过' };
      } else {
        console.error(`[阿里云短信认证] 校验失败: ${phone}, VerifyResult: ${verifyResult}`);
        return { success: false, message: '验证码错误' };
      }
    } else {
      console.error(`[阿里云短信认证] 校验失败: ${phone}, Code: ${response.body?.code}, Message: ${response.body?.message}`);
      return { success: false, message: response.body?.message || '验证码错误' };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[阿里云短信认证] 校验异常:', errMsg);
    return { success: false, message: '验证码校验失败' };
  }
}

/**
 * 检查阿里云短信认证是否已配置
 */
export function isAliyunSmsConfigured(): boolean {
  const config = getEnvConfig();
  return !!(config.accessKeyId && config.accessKeySecret && config.signName);
}
