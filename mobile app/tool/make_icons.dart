// Launcher icons for the Android build.
//
//   dart run tool/make_icons.dart
//
// Generated rather than committed as binaries so the mark follows the design
// tokens in `lib/theme.dart`: change the palette there, re-run this, and
// every density updates together.
//
// Pure Dart — a minimal PNG encoder (zlib deflate + CRC'd chunks). That keeps
// `flutter_launcher_icons` and a native image dependency out of the project
// for what amounts to five flat-colour rectangles.

import 'dart:io';
import 'dart:typed_data';
import 'dart:convert' show utf8;

// ---- palette (kept in step with lib/theme.dart) ---------------------------
const ink = [0x15, 0x14, 0x0F]; // T.dBg
const cream = [0xF3, 0xEF, 0xE6]; // T.bg
const mark = [0xD9, 0x47, 0x1F]; // T.mark

// CRC-32 is defined on 32-bit words, and Dart ints are 64-bit — `>>>` here
// shifts all 64 bits, unlike JavaScript's 32-bit `>>>`. So every step is
// masked back to 32 bits, and the table is Uint32List rather than Int32List
// so its high-bit entries are not negative.
//
// Get this wrong and the PNGs are still structurally perfect — right
// signature, right IHDR, right IEND — with invalid chunk checksums. Image
// viewers mostly ignore CRCs; AAPT2 does not, and rejects them with a bare
// "Unexpected error during compile". Validate the CRCs, not just the layout.
final _crcTable = () {
  final t = Uint32List(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) != 0 ? (0xEDB88320 ^ (c >>> 1)) & 0xFFFFFFFF : c >>> 1;
    }
    t[n] = c;
  }
  return t;
}();

int _crc32(List<int> bytes) {
  var c = 0xFFFFFFFF;
  for (final b in bytes) {
    c = (_crcTable[(c ^ b) & 0xFF] ^ (c >>> 8)) & 0xFFFFFFFF;
  }
  return (c ^ 0xFFFFFFFF) & 0xFFFFFFFF;
}

Uint8List _chunk(String type, List<int> data) {
  final out = BytesBuilder();
  final len = ByteData(4)..setUint32(0, data.length);
  out.add(len.buffer.asUint8List());
  final body = <int>[...utf8.encode(type), ...data];
  out.add(body);
  final crc = ByteData(4)..setUint32(0, _crc32(body));
  out.add(crc.buffer.asUint8List());
  return out.toBytes();
}

Uint8List _png(int size, List<int> rgb) {
  final ihdr = ByteData(13)
    ..setUint32(0, size)
    ..setUint32(4, size)
    ..setUint8(8, 8) // bit depth
    ..setUint8(9, 2) // truecolour RGB
    ..setUint8(10, 0)
    ..setUint8(11, 0)
    ..setUint8(12, 0);

  // One filter byte (0 = None) per scanline.
  final stride = size * 3;
  final raw = BytesBuilder();
  for (var y = 0; y < size; y++) {
    raw.addByte(0);
    raw.add(rgb.sublist(y * stride, (y + 1) * stride));
  }

  final out = BytesBuilder();
  out.add([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  out.add(_chunk('IHDR', ihdr.buffer.asUint8List()));
  out.add(_chunk('IDAT', ZLibCodec(level: 9).encode(raw.toBytes())));
  out.add(_chunk('IEND', const []));
  return out.toBytes();
}

/// Four columns stepping up, the last in vermilion. Supersampled 4x and
/// box-filtered — an aliased icon is the quickest way to look unfinished.
List<int> _draw(int size, double inset) {
  const ss = 4;
  final s = size * ss;
  final hi = List<int>.filled(s * s * 3, 0);
  for (var i = 0; i < s * s; i++) {
    hi[i * 3] = ink[0];
    hi[i * 3 + 1] = ink[1];
    hi[i * 3 + 2] = ink[2];
  }

  void fill(double x0, double y0, double x1, double y1, List<int> c) {
    final xa = x0.round().clamp(0, s), xb = x1.round().clamp(0, s);
    final ya = y0.round().clamp(0, s), yb = y1.round().clamp(0, s);
    for (var y = ya; y < yb; y++) {
      for (var x = xa; x < xb; x++) {
        final o = (y * s + x) * 3;
        hi[o] = c[0];
        hi[o + 1] = c[1];
        hi[o + 2] = c[2];
      }
    }
  }

  final pad = s * inset;
  final area = s - pad * 2;
  const cols = 4, gapRatio = 0.34;
  final colW = area / (cols + (cols - 1) * gapRatio);
  final gap = colW * gapRatio;
  const heights = [0.34, 0.56, 0.74, 1.0];
  final baseline = pad + area;

  for (var i = 0; i < cols; i++) {
    final x = pad + i * (colW + gap);
    fill(x, baseline - area * heights[i], x + colW, baseline, i == cols - 1 ? mark : cream);
  }

  // Downsample.
  final out = List<int>.filled(size * size * 3, 0);
  const n = ss * ss;
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var r = 0, g = 0, b = 0;
      for (var dy = 0; dy < ss; dy++) {
        for (var dx = 0; dx < ss; dx++) {
          final o = ((y * ss + dy) * s + (x * ss + dx)) * 3;
          r += hi[o];
          g += hi[o + 1];
          b += hi[o + 2];
        }
      }
      final o = (y * size + x) * 3;
      out[o] = (r / n).round();
      out[o + 1] = (g / n).round();
      out[o + 2] = (b / n).round();
    }
  }
  return out;
}

void main() {
  // Android's five density buckets for ic_launcher.
  const densities = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
  };

  for (final e in densities.entries) {
    final dir = Directory('android/app/src/main/res/mipmap-${e.key}');
    dir.createSync(recursive: true);
    final png = _png(e.value, _draw(e.value, 0.18));
    File('${dir.path}/ic_launcher.png').writeAsBytesSync(png);
    stdout.writeln('[icons] mipmap-${e.key}/ic_launcher.png  ${e.value}px  ${png.length}B');
  }
  // Play Store listing icon.
  File('store_icon.png').writeAsBytesSync(_png(512, _draw(512, 0.18)));
  stdout.writeln('[icons] done');
}
