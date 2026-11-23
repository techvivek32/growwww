import 'package:flutter/foundation.dart' show Uint8List;
import 'package:flutter/material.dart';
import '../api/client.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// A stored document — a consent selfie, a PAN/Aadhaar photo, a KYC file —
/// fetched on the app's own session and shown in place.
///
/// The web console links straight to `/api/consent/media`, which works there
/// because the browser already holds the session cookie. Handing that URL to
/// the phone's browser would send a request with no session, and the admin
/// would be shown the login page instead of the document. So the bytes are
/// fetched here, on the session the app already has.
///
/// Pinch to zoom: an ID photo read on a phone is useless at fit-to-width, and
/// checking a document is the entire reason for opening it.
class FileView extends StatefulWidget {
  final String title;
  final String subtitle;
  final String path;

  const FileView({
    super.key,
    required this.title,
    required this.subtitle,
    required this.path,
  });

  @override
  State<FileView> createState() => _FileViewState();
}

class _FileViewState extends State<FileView> {
  Uint8List? _bytes;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final b = await api.fileBytes(widget.path);
      if (mounted) setState(() => _bytes = b);
    } on ApiError catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not reach the server. Check your connection.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final b = _bytes;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      // Follows the app's theme rather than forcing the dark palette.
      //
      // It used to hardcode the dark one, and the title then vanished: the
      // theme's appBarTheme sets an explicit titleTextStyle whose colour is
      // the LIGHT theme's dark ink, and an explicit titleTextStyle beats the
      // bar's foregroundColor. Dark ink on a dark bar is invisible — only the
      // subtitle survived, because it carried a colour of its own. The bar was
      // left naming no document at all.
      appBar: AppBar(
        elevation: 0,
        // Two lines need more room than the default 56dp toolbar.
        toolbarHeight: 68,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(widget.title, style: const TextStyle(fontSize: 16)),
            Text(
              widget.subtitle,
              style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w400,
                  color: scheme.onSurface.withValues(alpha: 0.6)),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Center(
          child: _error != null
              ? Padding(
                  padding: const EdgeInsets.all(26),
                  child: ErrorState(message: _error!, onRetry: () {
                    setState(() => _error = null);
                    _load();
                  }),
                )
              : b == null
                  ? const CircularProgressIndicator(color: T.mark, strokeWidth: 2)
                  : InteractiveViewer(
                      minScale: 1,
                      maxScale: 6,
                      child: Image.memory(
                        b,
                        fit: BoxFit.contain,
                        // A stored file that is not a decodable image should say
                        // so, rather than showing Flutter's broken-image glyph
                        // and leaving the admin guessing whether it is missing
                        // or merely unsupported here.
                        errorBuilder: (context, error, stack) => const Padding(
                          padding: EdgeInsets.all(26),
                          child: Empty(
                            icon: Icons.description_outlined,
                            title: 'Cannot be shown here',
                            detail:
                                'This file is not an image the app can render — '
                                'a video, for instance. Open it on the website, '
                                'where it plays.',
                          ),
                        ),
                      ),
                    ),
        ),
      ),
    );
  }
}
