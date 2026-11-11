export function createIdempotentCallback<Args extends unknown[]>(
  callback?: (...args: Args) => void
): (...args: Args) => void {
  let reported = false
  return (...args) => {
    if (reported) {
      return
    }
    reported = true
    callback?.(...args)
  }
}
