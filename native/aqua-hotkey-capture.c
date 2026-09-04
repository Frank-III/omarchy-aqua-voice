#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#define MAX_DEVICES 64
#define BITS_PER_LONG (sizeof(unsigned long) * 8)
#define BIT_WORD(bit) ((bit) / BITS_PER_LONG)
#define BIT_MASK(bit) (1UL << ((bit) % BITS_PER_LONG))

static bool bit_is_set(const unsigned long *bits, int bit) {
  return (bits[BIT_WORD(bit)] & BIT_MASK(bit)) != 0;
}

static bool is_modifier(uint16_t code) {
  return code == KEY_LEFTSHIFT || code == KEY_RIGHTSHIFT ||
         code == KEY_LEFTCTRL || code == KEY_RIGHTCTRL ||
         code == KEY_LEFTALT || code == KEY_RIGHTALT ||
         code == KEY_LEFTMETA || code == KEY_RIGHTMETA ||
         code == KEY_CAPSLOCK;
}

static const char *key_name(uint16_t code) {
  static const char *const digits[] = {"1", "2", "3", "4", "5", "6", "7", "8", "9", "0"};
  static const char *const qwerty[] = {"Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"};
  static const char *const home[] = {"A", "S", "D", "F", "G", "H", "J", "K", "L"};
  static const char *const bottom[] = {"Z", "X", "C", "V", "B", "N", "M"};
  static char fallback[24];

  if (code >= KEY_1 && code <= KEY_0) return digits[code - KEY_1];
  if (code >= KEY_Q && code <= KEY_P) return qwerty[code - KEY_Q];
  if (code >= KEY_A && code <= KEY_L) return home[code - KEY_A];
  if (code >= KEY_Z && code <= KEY_M) return bottom[code - KEY_Z];
  if (code >= KEY_F1 && code <= KEY_F10) {
    snprintf(fallback, sizeof(fallback), "F%u", code - KEY_F1 + 1);
    return fallback;
  }
  if (code == KEY_F11) return "F11";
  if (code == KEY_F12) return "F12";
  if (code >= KEY_F13 && code <= KEY_F24) {
    snprintf(fallback, sizeof(fallback), "F%u", code - KEY_F13 + 13);
    return fallback;
  }
  switch (code) {
    case KEY_ESC: return "Escape";
    case KEY_TAB: return "Tab";
    case KEY_ENTER: return "Enter";
    case KEY_SPACE: return "Space";
    case KEY_BACKSPACE: return "Backspace";
    case KEY_INSERT: return "Insert";
    case KEY_DELETE: return "Delete";
    case KEY_HOME: return "Home";
    case KEY_END: return "End";
    case KEY_PAGEUP: return "PageUp";
    case KEY_PAGEDOWN: return "PageDown";
    case KEY_UP: return "Up";
    case KEY_DOWN: return "Down";
    case KEY_LEFT: return "Left";
    case KEY_RIGHT: return "Right";
    case KEY_PRINT: return "Print";
    case KEY_PAUSE: return "Pause";
    default:
      snprintf(fallback, sizeof(fallback), "code:%u", code);
      return fallback;
  }
}

static int64_t monotonic_ms(void) {
  struct timespec value;
  clock_gettime(CLOCK_MONOTONIC, &value);
  return (int64_t)value.tv_sec * 1000 + value.tv_nsec / 1000000;
}

static int open_keyboards(struct pollfd *fds) {
  int count = 0;
  for (int index = 0; index < MAX_DEVICES; index++) {
    char path[64];
    snprintf(path, sizeof(path), "/dev/input/event%d", index);
    int fd = open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (fd < 0) continue;

    unsigned long event_bits[BIT_WORD(EV_MAX) + 1];
    unsigned long key_bits[BIT_WORD(KEY_MAX) + 1];
    memset(event_bits, 0, sizeof(event_bits));
    memset(key_bits, 0, sizeof(key_bits));
    if (ioctl(fd, EVIOCGBIT(0, sizeof(event_bits)), event_bits) < 0 ||
        !bit_is_set(event_bits, EV_KEY) ||
        ioctl(fd, EVIOCGBIT(EV_KEY, sizeof(key_bits)), key_bits) < 0 ||
        (!bit_is_set(key_bits, KEY_A) && !bit_is_set(key_bits, KEY_ENTER))) {
      close(fd);
      continue;
    }
    fds[count++] = (struct pollfd){.fd = fd, .events = POLLIN};
  }
  return count;
}

static void close_all(struct pollfd *fds, int count) {
  for (int index = 0; index < count; index++) close(fds[index].fd);
}

int main(void) {
  struct pollfd fds[MAX_DEVICES];
  bool held[KEY_MAX + 1];
  memset(fds, 0, sizeof(fds));
  memset(held, 0, sizeof(held));

  const int count = open_keyboards(fds);
  if (count == 0) {
    fprintf(stderr, "no readable keyboard input devices\n");
    return 2;
  }

  long timeout_ms = 15000;
  const char *timeout_value = getenv("AQUA_HOTKEY_CAPTURE_TIMEOUT_MS");
  if (timeout_value != NULL) {
    const long parsed = strtol(timeout_value, NULL, 10);
    if (parsed >= 50 && parsed <= 60000) timeout_ms = parsed;
  }
  const int64_t deadline = monotonic_ms() + timeout_ms;
  while (monotonic_ms() < deadline) {
    const int remaining = (int)(deadline - monotonic_ms());
    const int ready = poll(fds, count, remaining < 250 ? remaining : 250);
    if (ready < 0) {
      if (errno == EINTR) continue;
      perror("poll");
      close_all(fds, count);
      return 2;
    }
    if (ready == 0) continue;

    for (int index = 0; index < count; index++) {
      if (!(fds[index].revents & POLLIN)) continue;
      struct input_event events[32];
      const ssize_t bytes = read(fds[index].fd, events, sizeof(events));
      if (bytes <= 0) continue;
      const size_t event_count = (size_t)bytes / sizeof(struct input_event);
      for (size_t event_index = 0; event_index < event_count; event_index++) {
        const struct input_event event = events[event_index];
        if (event.type != EV_KEY || event.code > KEY_MAX) continue;
        if (event.value == 0) held[event.code] = false;
        else if (event.value == 1) held[event.code] = true;
        else continue;

        if (event.value != 1 || is_modifier(event.code)) continue;
        if (event.code == KEY_ESC) {
          puts("{\"ok\":false,\"cancelled\":true}");
          close_all(fds, count);
          return 1;
        }
        if (event.code >= BTN_MISC) continue;

        const uint16_t modifier_codes[] = {
          KEY_LEFTCTRL, KEY_RIGHTCTRL, KEY_CAPSLOCK,
          KEY_LEFTALT, KEY_RIGHTALT,
          KEY_LEFTSHIFT, KEY_RIGHTSHIFT,
          KEY_LEFTMETA, KEY_RIGHTMETA,
        };
        printf("{\"ok\":true,\"keyCode\":%u,\"keyName\":\"%s\",\"rawModifiers\":[",
               event.code, key_name(event.code));
        bool first = true;
        for (size_t modifier_index = 0;
             modifier_index < sizeof(modifier_codes) / sizeof(modifier_codes[0]);
             modifier_index++) {
          const uint16_t code = modifier_codes[modifier_index];
          if (!held[code]) continue;
          printf("%s%u", first ? "" : ",", code);
          first = false;
        }
        puts("]}");
        close_all(fds, count);
        return 0;
      }
    }
  }

  puts("{\"ok\":false,\"timeout\":true}");
  close_all(fds, count);
  return 1;
}
