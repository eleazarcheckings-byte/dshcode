# Agent Note: 首次设置时选择模型提供方

Status: implemented

[English](2026-09-15-onboarding-provider-choice.md) | 中文

## 问题

强制提供 DeepSeek 凭据，会阻止其他提供方的用户进入「模型」。完成设置也不能证明未经测试的提供方已经通过身份验证。

## 决策

[First Light](../../../../packages/client/ui-settings-models/src/client/FirstLight.tsx) 允许验证 DeepSeek，也允许明确选择在完成其余设置后配置其他提供方。推迟配置时，确认页说明模型设置尚未完成。只有个人资料、回复风格、智能体记忆和完成标记全部成功保存后，才会转到「模型」；写入失败时保留答案并提供重试。其他提供方的已配置状态不能触发 DeepSeek 自动探测，迟到的探测响应也不能将推迟配置的确认页改为已连接。

后续的 [DeepSeek 提示](../../../../packages/client/ui-settings-models/src/client/DeepSeekOnboardingDialog.tsx) 也提供明确进入「模型」的操作。两种操作都先完成当前协调步骤，再打开「模型」。[SettingsRoot](../../../../packages/client/ui-settings-general/src/client/SettingsRoot.tsx) 在设置打开时暂停待完成的引导，释放引导弹窗占用的焦点和 inert 状态。关闭设置后，继续下一个待完成的步骤。

提供方选择只改变导航，不写入凭据、提供方配置或就绪标记。现有「模型」页面仍负责提供方配置。已经完成的 First Light 设置不会在下次挂载时再次打开「模型」。

设置会在首个和末个可用控件处循环处理 Tab 和 Shift+Tab。处理器排除已禁用、隐藏和不可通过 Tab 访问的控件，并将嵌套对话框中的事件留给其所有者处理。由于设置面板位于应用根节点内，因此不会将根节点设为 inert。First Light 的操作行在窄屏上换行。

## 考虑过的替代方案

**使用其他提供方前必须配置 DeepSeek。** 这要求用户先提供一个不打算使用的提供方的凭据。

**跳过设置时将模型标记为就绪。** 这把导航选择混同为提供方验证证据，使用户误判请求是否可以运行。

**在待完成的引导弹窗下面打开「模型」。** 弹窗仍占用焦点和 inert 状态，目标页面无法操作。该切换由设置外壳负责，因为功能弹窗无法自行协调下一个注册步骤。

## 影响

用户可以先完成个人设置，再配置模型，因此完成设置本身不保证聊天可以运行。探测失败或尚未结束时，仍可明确选择其他提供方。推迟配置不是持久化的提供方偏好；如果后续协调流程仍没有可用的提供方，提示可以再次提供相同选择。

## 验证

[First Light 测试](../../../../packages/client/ui-settings-models/tests/first-light.client.spec.tsx) 覆盖中英文无密钥设置、实际渲染的推迟配置确认页、成功及拒绝的完成写入、提供方状态不变、迟到的探测响应、其他已配置的提供方，以及原有的 DeepSeek 密钥保存流程。[凭据提示测试](../../../../packages/client/ui-settings-models/tests/onboarding-dialog.client.spec.tsx) 覆盖不写入凭据的明确导航。[设置外壳测试](../../../../packages/client/ui-settings-general/tests/settings-root.client.spec.tsx) 验证真实弹窗的 inert 清理，以及关闭设置后恢复引导。
