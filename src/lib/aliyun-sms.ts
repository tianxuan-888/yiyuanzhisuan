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

// 环境变量
const ACCESS_KEY_ID = process.env.ALIYUN_SMS_ACCESS_KEY_ID || '';
const ACCESS_KEY_SECRET = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET || '';
// 短信认证服务预置签名和模板（从号码认证服务控制台获取）
const SIGN_NAME = process.env.ALIYUN_SMS_SIGN_NAME || '';
const TEMPLATE_CODE = process.env.ALIYUN_SMS_TEMPLATE_CODE || '';

let client: Dypnsapi | null = null;

/**
 * 获取阿里云号码认证服务客户端（单例）
 */
function getClient(): Dypnsapi {
  if (!client) {
    const config = new OpenApi.Config({
      accessKeyId: ACCESS_KEY_ID,
      accessKeySecret: ACCESS_KEY_SECRET,
      endpoint: 'dypnsapi.aliyuncs.com',
    });
    client = new Dypnsapi(config);
  }
  return client;
}

/**
 * 发送验证码短信（使用短信认证服务 SendSmsVerifyCode）
 * @param phone 手机号（纯数字，如 13800000001）
 * @param code 验证码（4-6位数字）
 * @returns 发送结果
 */
export async function sendSmsVerifyCode(phone: string, code: string): Promise<{
  success: boolean;
  message: string;
  requestId?: string;
}> {
  // 检查阿里云配置是否完整
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !SIGN_NAME || !TEMPLATE_CODE) {
    console.warn('[阿里云短信认证] 配置不完整，跳过真实发送。需要在环境变量中配置：');
    console.warn('  ALIYUN_SMS_ACCESS_KEY_ID');
    console.warn('  ALIYUN_SMS_ACCESS_KEY_SECRET');
    console.warn('  ALIYUN_SMS_SIGN_NAME（号码认证服务控制台 → 预置签名）');
    console.warn('  ALIYUN_SMS_TEMPLATE_CODE（号码认证服务控制台 → 预置模板）');
    return {
      success: true,
      message: '验证码已发送（开发模式，未实际发送短信）',
    };
  }

  try {
    const smsClient = getClient();
    const request = new SendSmsVerifyCodeRequest({
      phoneNumber: phone,
      signName: SIGN_NAME,
      templateCode: TEMPLATE_CODE,
      templateParam: JSON.stringify({ code: '##code##' }),  // 使用 ##code## 占位符，平台自动替换
      codeType: 1,          // 纯数字验证码
      codeLength: 6,        // 6位验证码
      validTime: 300,       // 有效期5分钟（300秒）
      interval: 60,         // 发送间隔60秒
      returnVerifyCode: false,  // 不在响应中返回验证码（我们自己在数据库存储）
    });

    const runtime = new RuntimeOptions({});
    const response = await smsClient.sendSmsVerifyCodeWithOptions(request, runtime);

    if (response.body?.code === 'OK') {
      console.log(`[阿里云短信认证] 发送成功: ${phone}, RequestId: ${response.body.requestId}`);
      return {
        success: true,
        message: '验证码已发送',
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
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET || !SIGN_NAME || !TEMPLATE_CODE) {
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

    if (response.body?.code === 'OK') {
      return { success: true, message: '验证码校验通过' };
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
  return !!(ACCESS_KEY_ID && ACCESS_KEY_SECRET && SIGN_NAME && TEMPLATE_CODE);
}
