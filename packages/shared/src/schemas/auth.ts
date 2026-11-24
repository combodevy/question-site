import { z } from 'zod';

export const MIN_PASSWORD_LEN = 6;
export const MAX_PASSWORD_LEN = 128;

export const UsernameSchema = z
    .string()
    .trim()
    .min(2, '用户名长度需在 2–32 位之间')
    .max(32, '用户名长度需在 2–32 位之间')
    .regex(
        /^[a-zA-Z0-9_\u4e00-\u9fa5.-]+$/,
        '用户名只能包含字母、数字、下划线、点、横线或中文'
    )
    .refine((val) => !val.includes('@'), '用户名不能包含 @ 符号');

export const PasswordSchema = z
    .string()
    .min(MIN_PASSWORD_LEN, `密码长度需在 ${MIN_PASSWORD_LEN}–${MAX_PASSWORD_LEN} 位之间`)
    .max(MAX_PASSWORD_LEN, `密码长度需在 ${MIN_PASSWORD_LEN}–${MAX_PASSWORD_LEN} 位之间`);

export const SignupSchema = z.object({
    username: z.string().optional(),
    email: z.string().optional(),
    password: z.string(),
});

export const LoginSchema = z.object({
    username: z.string().optional(),
    email: z.string().optional(),
    password: z.string(),
});

export const ChangePasswordSchema = z.object({
    oldPassword: z.string().min(1, '请填写原密码和新密码').max(MAX_PASSWORD_LEN),
    newPassword: PasswordSchema,
});

export const DeleteAccountSchema = z.object({
    password: z.string().min(1, '请输入密码确认注销').max(MAX_PASSWORD_LEN),
});

export const AdminCreateUserSchema = z.object({
    username: z.string().optional(),
    email: z.string().optional(),
    password: PasswordSchema,
});

export const AdminResetPasswordSchema = z.object({
    userId: z.string().min(1),
    newPassword: PasswordSchema,
});
