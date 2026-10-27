// Test helper for tests/shell.mjs (gcc -o xkey xkey.c -lX11 -lXtst):
//   xkey <keysym-name> <1|0>   press or release a key through XTest
//   xkey blur                  take keyboard focus away from every window, as switching apps would
#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <stdlib.h>
#include <string.h>
int main(int c, char **v) {
  Display *d = XOpenDisplay(0);
  if (!d || c < 2) return 1;
  if (!strcmp(v[1], "blur")) XSetInputFocus(d, None, RevertToNone, CurrentTime);
  else if (c == 3) XTestFakeKeyEvent(d, XKeysymToKeycode(d, XStringToKeysym(v[1])), atoi(v[2]), 0);
  else return 1;
  XFlush(d); XCloseDisplay(d); return 0;
}
