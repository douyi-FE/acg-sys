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
  <section class="panel session-form">
    <h1>{{ route.path === '/change-password' ? '修改密码' : '登录' }}</h1>
    <p v-if="auth.mustChangePassword">当前账户必须修改密码后才能继续使用。</p>
    <a-alert v-if="error || auth.error" type="error" :message="error || auth.error" />
    <p v-if="auth.logoutNotice" role="alert">{{ auth.logoutNotice }}</p>
    <form novalidate @submit.prevent="submit">
      <label v-if="route.path !== '/change-password'" v-field="usernameError(username)">用户名<a-input v-model:value="username" autocomplete="username" /></label>
      <label v-field="required(password, '密码')">{{ route.path === '/change-password' ? '当前密码' : '密码' }}<a-input-password v-model:value="password" autocomplete="current-password" /></label>
      <label v-if="route.path === '/change-password'" v-field="passwordError(newPassword) || (newPassword === password ? '新密码不能与当前密码相同' : undefined)">新密码<a-input-password v-model:value="newPassword" autocomplete="new-password" /></label>
      <a-button html-type="submit" type="primary" :loading="busy">提交</a-button>
      <router-link v-if="!auth.mustChangePassword" to="/public">以游客身份访问公开内容</router-link>
    </form>
  </section>
</template>
<style scoped>
.session-form { max-width: 460px; margin: 10vh auto; }
form, label { display: grid; gap: 16px; }
</style>
