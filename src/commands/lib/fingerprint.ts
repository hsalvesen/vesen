/*!
 * The fingerprint sudo's show asks a touch screen's thumb on (commands/lib/rick.ts,
 * RICK_FINGERPRINT): Omarchy's fingerprint artwork (github.com/omacom/omarchy), as
 * fingerprint-tui traces it to text (github.com/standardagents/fingerprint-tui,
 * fingerprint_tui/art.py), its common indent taken off. Under the MIT licence, whose notice the
 * site also serves at /licences/fingerprint.txt (public/licences/fingerprint.txt), since the build
 * drops comments:
 *
 * Copyright (c) David Heinemeier Hansson
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/** The print, row by row: ridges drawn in @, as the trace has them. */
export const FINGERPRINT: readonly string[] = [
  '                   @@@@@@@@@@@@@',
  '             @@@@@@@@@@@@@@@@@@@@@@@@@@',
  '          @@@@@@@@@             @@@@@@@@@@',
  '       @@@@@@@                        @@@@@@@',
  '     @@@@@@     @@@@@@@@@@@@@@@@@@@      @@@@@@@',
  '   @@@@@    @@@@@@@@@@@@@@@@@@@@@@@@@@@     @@@',
  '   @@@@   @@@@@@@                  @@@@@@@',
  '        @@@@@@      @@@@@@@@@@@@      @@@@@@',
  '      @@@@@     @@@@@@@@@@@@@@@@@@@@     @@@@@',
  '    @@@@@    @@@@@@@            @@@@@@@    @@@@@',
  '   @@@@@   @@@@@@      @@@@@       @@@@@@    @@@@@',
  '  @@@@    @@@@     @@@@@@@@@@@@@@     @@@@@   @@@@',
  ' @@@@   @@@@@   @@@@@@@@    @@@@@@@@   @@@@@',
  ' @@@   @@@@   @@@@@@            @@@@@    @@@@  @@@',
  '      @@@@   @@@@@    @@@@@@@@    @@@@@   @@@@ @@@@',
  '    @@@@@   @@@@   @@@@@@@@@@@@@   @@@@   @@@@ @@@@',
  '  @@@@@@   @@@@   @@@@@      @@@@   @@@@   @@@  @@@@',
  '@@@@@@    @@@@   @@@@         @@@@  @@@@   @@@  @@@@',
  '@@@@    @@@@@   @@@@    @@@@  @@@@  @@@@  @@@@  @@@@',
  '       @@@@@   @@@@    @@@@@   @@@  @@@@  @@@@  @@@@',
  '    @@@@@@    @@@@    @@@@    @@@@  @@@@  @@@@  @@@@',
  '  @@@@@@    @@@@@    @@@@    @@@@@  @@@   @@@   @@@@',
  '@@@@@@    @@@@@@   @@@@@    @@@@@  @@@@  @@@@   @@@@',
  '@@@     @@@@@@    @@@@@    @@@@    @@@@  @@@@   @@@',
  '      @@@@@@    @@@@@    @@@@@     @@@   @@@@  @@@@',
  '   @@@@@@     @@@@@     @@@@@      @@@@   @@@@ @@@@',
  ' @@@@@@     @@@@@@    @@@@@  @@@@@ @@@@   @@@@',
  '@@@@      @@@@@@    @@@@@    @@@@  @@@@    @@@@@',
  '        @@@@@@    @@@@@      @@@    @@@@     @@@@@',
  '     @@@@@@     @@@@@@       @@@     @@@@@     @@',
  '   @@@@@@     @@@@@          @@@@     @@@@@@@@',
  '   @@@@    @@@@@@   @@@@@@@   @@@@@      @@@@@@',
  '         @@@@@@   @@@@@@@@@@@  @@@@@@',
  '        @@@@@   @@@@@    @@@@@   @@@@@',
  '               @@@@       @@@@@    @@',
  '                           @@@',
];
