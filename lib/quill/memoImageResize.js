/** Resize module config — drag handles + size label; images persist `width` attribute. */
export const MEMO_IMAGE_RESIZE_OPTIONS = {
  modules: ['Resize', 'DisplaySize'],
  parchment: {
    image: {
      attribute: ['width'],
      limit: {
        minWidth: 80,
      },
    },
  },
};
