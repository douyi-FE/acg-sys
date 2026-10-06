<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useFactoryStore } from '../../stores/factory'
import { useFieldValidation, required, usernameError, passwordError } from '../../composables/fieldValidation'
const { vField, validateFields } = useFieldValidation()
const auth = useAuthStore()
const store = useFactoryStore()
const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const newPassword = ref('')
const busy = ref(false)
const error = ref('')
async function submit() {
  if (busy.value || !validateFields()) return
  busy.value = true
  error.value = ''
  try {
    if (route.path === '/change-password') await auth.changePassword(password.value, newPassword.value)
    else await auth.login(username.value, password.value)
    password.value = ''; newPassword.value = ''
    store.reset()
    if (!auth.session?.user) { await router.push('/login'); return }
    if (auth.mustChangePassword) { await router.push('/change-password'); return }
    await store.refresh()
    await router.push('/')
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' }
  finally { busy.value = false }
}
</script>
<template>
  <main class="auth-shell">
    <div class="auth-glow auth-glow-one" />
    <div class="auth-glow auth-glow-two" />
    <section class="auth-layout">
      <div class="brand-panel">
        <div class="brand-mark"><span>✦</span></div>
        <p class="eyebrow">AI CONTENT FACTORY</p>
        <h1>让每个灵感，<br /><em>变成可交付的内容。</em></h1>
        <p class="brand-copy">从选题、脚本到视频与图文交付，在一个生产空间里完成创作、审核与管理。</p>
        <div class="feature-list">
          <span><i>01</i> AI 视频与图文生产</span>
          <span><i>02</i> 工作流与质量门</span>
          <span><i>03</i> 人工审核与资产沉淀</span>
        </div>
      </div>
      <section class="panel session-form">
        <div class="form-heading">
          <span class="form-kicker">{{ route.path === '/change-password' ? 'ACCOUNT SECURITY' : 'WELCOME BACK' }}</span>
          <h2>{{ route.path === '/change-password' ? '修改密码' : '登录生产空间' }}</h2>
          <p>{{ route.path === '/change-password' ? '为了保护工作空间，请先设置新的登录密码。' : '登录后继续你的内容生产流程。' }}</p>
        </div>
        <a-alert v-if="error || auth.error" type="error" :message="error || auth.error" />
        <p v-if="auth.logoutNotice" class="logout-notice" role="alert">{{ auth.logoutNotice }}</p>
        <p v-if="auth.mustChangePassword" class="security-notice">当前账户必须修改密码后才能继续使用。</p>
        <form novalidate @submit.prevent="submit">
          <label v-if="route.path !== '/change-password'" v-field="usernameError(username)">
            <span>用户名</span>
            <a-input v-model:value="username" autocomplete="username" placeholder="输入用户名" size="large" />
          </label>
          <label v-field="required(password, '密码')">
            <span>{{ route.path === '/change-password' ? '当前密码' : '密码' }}</span>
            <a-input-password v-model:value="password" autocomplete="current-password" placeholder="输入密码" size="large" />
          </label>
          <label v-if="route.path === '/change-password'" v-field="passwordError(newPassword) || (newPassword === password ? '新密码不能与当前密码相同' : undefined)">
            <span>新密码</span>
            <a-input-password v-model:value="newPassword" autocomplete="new-password" placeholder="设置新密码" size="large" />
          </label>
          <a-button class="submit-button" html-type="submit" type="primary" size="large" :loading="busy">
            {{ route.path === '/change-password' ? '保存新密码' : '进入生产空间' }} <span>→</span>
          </a-button>
          <router-link v-if="!auth.mustChangePassword" class="guest-link" to="/public">以游客身份访问公开内容</router-link>
        </form>
        <p class="form-footer">安全连接 · 权限控制 · 内容可追溯</p>
      </section>
    </section>
    <footer class="auth-footer">© 2026 AI Content Factory <span>为创作而生</span></footer>
  </main>
</template>
<style scoped>
.auth-shell {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: grid;
  place-items: center;
  padding: 48px 7vw 32px;
  color: #f8f7ff;
  background:
    linear-gradient(105deg, rgba(8, 11, 32, .98) 0%, rgba(14, 17, 49, .92) 45%, rgba(36, 26, 78, .8) 100%),
    url('/mock-assets/login-hero-background-v1.png') center / cover;
}
.auth-shell::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 75% 20%, rgba(105, 92, 220, .22), transparent 30%), linear-gradient(90deg, transparent, rgba(5, 7, 24, .25));
}
.auth-layout {
  position: relative;
  z-index: 1;
  width: min(1120px, 100%);
  display: grid;
  grid-template-columns: 1fr minmax(380px, 460px);
  align-items: center;
  gap: clamp(48px, 9vw, 140px);
}
.brand-panel { max-width: 600px; }
.brand-mark {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  margin-bottom: 28px;
  border: 1px solid rgba(255,255,255,.3);
  border-radius: 15px;
  color: #fff;
  background: linear-gradient(135deg, #7568f4, #a873df);
  box-shadow: 0 12px 30px rgba(90, 70, 220, .35);
  font-size: 25px;
}
.eyebrow, .form-kicker {
  margin: 0;
  color: #a9a2ff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .2em;
}
.brand-panel h1 {
  margin: 18px 0;
  font-size: clamp(38px, 5vw, 68px);
  line-height: 1.08;
  letter-spacing: -.06em;
}
.brand-panel h1 em {
  color: #c9c4ff;
  font-style: normal;
}
.brand-copy {
  max-width: 450px;
  margin: 0;
  color: #b8b8cc;
  font-size: 16px;
  line-height: 1.8;
}
.feature-list {
  display: grid;
  gap: 13px;
  margin-top: 42px;
  color: #e3e1ef;
  font-size: 13px;
}
.feature-list span { display: flex; align-items: center; gap: 14px; }
.feature-list i {
  min-width: 28px;
  color: #8980f5;
  font-size: 10px;
  font-style: normal;
  letter-spacing: .08em;
}
.session-form {
  max-width: 460px;
  margin: 0;
  padding: 38px;
  border: 1px solid rgba(255,255,255,.35);
  border-radius: 24px;
  background: rgba(255,255,255,.93);
  color: #222137;
  box-shadow: 0 24px 80px rgba(0,0,0,.3);
  backdrop-filter: blur(18px);
}
.form-heading h2 { margin: 10px 0 8px; color: #24213d; font-size: 28px; letter-spacing: -.04em; }
.form-heading p { margin: 0 0 28px; color: #858398; font-size: 13px; }
form, label { display: grid; gap: 9px; }
form { gap: 18px; }
label > span { color: #4b4860; font-size: 13px; font-weight: 600; }
.submit-button { width: 100%; margin-top: 4px; border: 0; border-radius: 10px; background: #635bdb; box-shadow: 0 10px 20px rgba(99,91,219,.25); }
.submit-button span { margin-left: 8px; font-size: 18px; }
.guest-link { color: #635bdb; font-size: 13px; text-align: center; }
.logout-notice, .security-notice { color: #93621b; font-size: 13px; line-height: 1.6; }
.form-footer { margin: 28px 0 0; padding-top: 18px; border-top: 1px solid #ecebf3; color: #aaa7b8; font-size: 11px; text-align: center; }
.auth-footer { position: absolute; z-index: 1; bottom: 18px; color: rgba(255,255,255,.45); font-size: 11px; letter-spacing: .04em; }
.auth-footer span { margin-left: 14px; color: rgba(255,255,255,.28); }
.auth-glow { position: absolute; z-index: 0; width: 420px; height: 420px; border-radius: 50%; filter: blur(70px); opacity: .24; }
.auth-glow-one { top: -180px; left: 35%; background: #695ce0; }
.auth-glow-two { right: -180px; bottom: -200px; background: #42b8d5; }
@media (max-width: 800px) {
  .auth-shell { padding: 28px 20px 70px; }
  .auth-layout { grid-template-columns: 1fr; gap: 36px; }
  .brand-panel h1 { font-size: 42px; }
  .brand-copy, .feature-list { display: none; }
  .session-form { width: 100%; padding: 28px 22px; }
}
</style>
