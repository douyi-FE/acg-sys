<script setup lang="ts">
import { useAuthStore } from '../../stores/auth'
const auth = useAuthStore()
</script>
<template>
  <section class="panel">
    <h1>无法访问</h1>
    <p role="alert">{{ auth.error || '当前会话没有此页面所需的权限。' }}</p>
    <router-link to="/login">登录其他账户</router-link>
    <a-button @click="auth.load().catch(() => undefined)">重新读取权限</a-button>
    <router-link to="/">返回工作台</router-link>
  </section>
</template>
