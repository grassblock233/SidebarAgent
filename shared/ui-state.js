export function getActionButtonState({ busy, submitting, hasSource, hasText }) {
  if (busy) {
    return {
      disabled: false,
      generating: true,
      label: "停止生成"
    };
  }

  return {
    disabled: Boolean(submitting || !hasSource || !hasText),
    generating: false,
    label: "发送"
  };
}
